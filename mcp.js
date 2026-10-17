/**
 * MCP Server with Streamable HTTP Transport
 * Following MCP SDK standard implementation with AlSalam Hospital tools
 */

import "dotenv/config";
import { randomUUID } from 'node:crypto';
import fs from "fs";
import https from "https";
import util from "node:util";
import path from "path";
import express from "express";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { fetch, Agent } from "undici";

const REQUEST_TIMEOUT_MS = 120000;
const DAYS_CACHE_TTL_MS = 2 * 60 * 1000;
const DAYS_CACHE_MAX_ENTRIES = 500;
const MAX_LOG_PREVIEW_CHARS = 1200;
const TOOL_PAYLOAD_LOG_PREVIEW_CHARS = 100000;
const KUWAIT_TIMEZONE = "Asia/Kuwait";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "logs");
const WACRM_WEBHOOK_URL = process.env.WACRM_WEBHOOK_URL?.trim() || "https://127.0.0.1:3002/api/whatsapp/webhook";
const RESTART_REQUEST_EXIT_CODE = 75;
const FATAL_ERROR_EXIT_CODE = 70;
const ENABLE_INTERNAL_SUPERVISOR = process.env.ENABLE_INTERNAL_SUPERVISOR !== "false" && process.env.ENABLE_INTERNAL_SUPERVISOR !== "0";
const IS_SUPERVISOR_CHILD = process.env.MCP_SUPERVISOR_CHILD === "1";
const daysCache = new Map();
const agent = new Agent({
    keepAliveTimeout: 120000,
    keepAliveMaxTimeout: 120000,
    pipelining: 0,
    connect: { rejectUnauthorized: false }
});

fs.mkdirSync(LOGS_DIR, { recursive: true });

const kuwaitDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: KUWAIT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
});

const kuwaitDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: KUWAIT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
});

function getKuwaitTimestampParts() {
    const parts = kuwaitDateTimeFormatter.formatToParts(new Date());
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return values;
}

function getKuwaitTimestamp() {
    const { year, month, day, hour, minute, second } = getKuwaitTimestampParts();
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function getDailyLogFilePath() {
    return path.join(LOGS_DIR, `${kuwaitDateFormatter.format(new Date())}.log`);
}

function formatLogArgs(args) {
    return args.map((arg) => {
        if (typeof arg === "string") return arg;
        return util.inspect(arg, { depth: 6, colors: false, breakLength: Infinity, maxArrayLength: 50 });
    }).join(" ");
}

function serializeForLog(value) {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return util.inspect(value, { depth: 8, colors: false, breakLength: Infinity, maxArrayLength: 200 });
    }
}

const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

function writeStructuredLog(level, args) {
    const line = `[${getKuwaitTimestamp()}] [${level}] ${formatLogArgs(args)}`;
    const logMethod = level === "ERROR" ? originalConsole.error : level === "WARN" ? originalConsole.warn : originalConsole.log;
    logMethod(line);
    try {
        fs.appendFileSync(getDailyLogFilePath(), `${line}\n`, "utf8");
    } catch (fileError) {
        originalConsole.error(`[${getKuwaitTimestamp()}] [ERROR] Failed to write log file: ${fileError.message}`);
    }
}

console.log = (...args) => writeStructuredLog("INFO", args);
console.info = (...args) => writeStructuredLog("INFO", args);
console.warn = (...args) => writeStructuredLog("WARN", args);
console.error = (...args) => writeStructuredLog("ERROR", args);

const log = (message, ...args) => console.log("[Server]", message, ...args);
const warn = (message, ...args) => console.warn("[Server]", message, ...args);
const errorLog = (message, ...args) => console.error("[Server]", message, ...args);
const previewText = (value, limit = MAX_LOG_PREVIEW_CHARS) => {
    if (value === undefined || value === null) return "";
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length <= limit ? text : `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`;
};

function pruneDaysCache() {
    const cutoff = Date.now() - DAYS_CACHE_TTL_MS;
    for (const [key, entry] of daysCache.entries()) {
        if (!entry || entry.timestamp < cutoff) {
            daysCache.delete(key);
        }
    }
    if (daysCache.size <= DAYS_CACHE_MAX_ENTRIES) return;
    const sorted = [...daysCache.entries()].sort((a, b) => (a[1]?.timestamp ?? 0) - (b[1]?.timestamp ?? 0));
    const removeCount = daysCache.size - DAYS_CACHE_MAX_ENTRIES;
    for (let i = 0; i < removeCount; i += 1) {
        daysCache.delete(sorted[i][0]);
    }
}

const memoryLogInterval = setInterval(() => {
    const mem = process.memoryUsage();
    const toMB = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;
    log(`[Memory] rss=${toMB(mem.rss)}MB heapUsed=${toMB(mem.heapUsed)}MB heapTotal=${toMB(mem.heapTotal)}MB sessions=${Object.keys(transports).length} daysCache=${daysCache.size}`);
}, 60_000);
memoryLogInterval.unref();

function debugAsJsonResponse(payload) {
    const result = asJsonResponse(payload);
    log(`asJsonResponse output type: ${typeof result}`);
    log(`asJsonResponse output preview: ${previewText(result)}`);
    return result;
}

// Usage in your tool:
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const start = Date.now();
    log(`[API Request] ${options.method || "GET"} ${url}`);
    try {
        const response = await fetch(url, { ...options, dispatcher: agent, signal: controller.signal });
        log(`[API Response] ${options.method || "GET"} ${url} -> ${response.status} (${Date.now() - start}ms)`);
        return response;
    } catch (error) {
        errorLog(`[API Error] ${url}: ${error.message} (${Date.now() - start}ms)`);
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function formatDateDDMMYYYY(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// Helper: wrap any payload in a valid MCP tool response
// MCP expects content items with types like "text", "image", "audio", "resource", etc.
// We serialize structured data as JSON inside a text content item.
const asJsonResponse = (payload) => ({
    content: [
        {
            type: "text",
            text: JSON.stringify(payload)
        }
    ]
});

// Helper: Send WhatsApp text messages via Graph API
async function sendWhatsAppText(phoneNumber, message) {
    const facebookPhoneId = process.env.FACEBOOK_PHONE_ID?.trim();
    const facebookAuthToken = process.env.FACEBOOK_AUTH_TOKEN?.trim();

    if (!facebookPhoneId || !facebookAuthToken) {
        throw new Error("Missing WhatsApp credentials: set FACEBOOK_PHONE_ID and FACEBOOK_AUTH_TOKEN in the environment.");
    }

    const cleanPhoneNumber = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
    const whatsappEndpoint = `https://graph.facebook.com/v21.0/${facebookPhoneId}/messages`;

    const response = await fetchWithTimeout(whatsappEndpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${facebookAuthToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanPhoneNumber,
            type: "text",
            text: {
                preview_url: false,
                body: message
            }
        })
    });

    const data = await response.json().catch(() => ({}));
    log(`[WhatsApp] Message dispatch to ${cleanPhoneNumber} -> ${response.status}`);

    return {
        success: response.ok,
        status: response.status,
        phoneNumber,
        cleanPhoneNumber,
        whatsappResponse: data,
        endpoint: whatsappEndpoint
    };
}

const app = express();

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = Buffer.from(buf);
    req.rawBodySize = buf.length;
    req.rawBodyPreview = previewText(buf.toString("utf8"));
  }
}));

import testRouter from './routers/test.js';

app.use('/test', testRouter);

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version, Last-Event-ID');
    res.header('Access-Control-Expose-Headers', 'mcp-session-id');
    res.header('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use('/webhook', (req, res, next) => {
    const start = Date.now();
    log(`[Webhook] Incoming ${req.method} ${req.originalUrl} ip=${req.ip || req.socket?.remoteAddress || "unknown"}`);
    res.on('finish', () => {
        log(`[Webhook] Completed ${req.method} ${req.originalUrl} status=${res.statusCode} durationMs=${Date.now() - start}`);
    });
    next();
});

async function forwardWebhook(req, res) {
    const target = new URL(WACRM_WEBHOOK_URL);
    const queryAt = req.originalUrl.indexOf('?');
    if (queryAt >= 0) target.search = req.originalUrl.slice(queryAt + 1);

    const headers = { accept: req.get('accept') || '*/*' };
    if (req.get('content-type')) headers['content-type'] = req.get('content-type');
    if (req.get('x-hub-signature-256')) headers['x-hub-signature-256'] = req.get('x-hub-signature-256');
    if (req.get('user-agent')) headers['user-agent'] = req.get('user-agent');

    try {
        const upstream = await fetchWithTimeout(target, {
            method: req.method,
            headers,
            body: req.method === 'POST' ? (req.rawBody || Buffer.from(JSON.stringify(req.body ?? {}))) : undefined
        }, 60_000);
        const body = Buffer.from(await upstream.arrayBuffer());
        const contentType = upstream.headers.get('content-type');
        if (contentType) res.type(contentType);
        log(`[Webhook] Forwarded ${req.method} to wacrmora status=${upstream.status}`);
        return res.status(upstream.status).send(body);
    } catch (error) {
        errorLog(`[Webhook] wacrmora forward failed: ${error.message}`);
        return res.status(502).json({ error: 'Webhook upstream unavailable' });
    }
}

app.get('/webhook', forwardWebhook);
app.post('/webhook', forwardWebhook);

// Function to create MCP server instance
const createServer = () => {
    const server = new McpServer({
        name: "AlSalamHospital_StreamableHTTP",
        version: "1.0.0"
    });
    const originalRegisterTool = server.registerTool.bind(server);

    server.registerTool = (name, config, handler) => originalRegisterTool(
        name,
        config,
        async (...handlerArgs) => {
            const startedAt = Date.now();
            const incomingPayload = handlerArgs.length <= 1 ? handlerArgs[0] : handlerArgs;
            console.log(
                `[ToolPayload] ${name} incoming payload: ${previewText(serializeForLog(incomingPayload), TOOL_PAYLOAD_LOG_PREVIEW_CHARS)}`
            );

            try {
                const result = await handler(...handlerArgs);
                console.log(
                    `[ToolPayload] ${name} outgoing payload (${Date.now() - startedAt}ms): ${previewText(serializeForLog(result), TOOL_PAYLOAD_LOG_PREVIEW_CHARS)}`
                );
                return result;
            } catch (error) {
                console.error(
                    `[ToolPayload] ${name} failed after ${Date.now() - startedAt}ms. incoming payload: ${previewText(serializeForLog(incomingPayload), TOOL_PAYLOAD_LOG_PREVIEW_CHARS)}`
                );
                console.error(`[ToolPayload] ${name} error:`, error);
                throw error;
            }
        }
    );

    // Register search_individual tool
    server.registerTool(
        "search_individual",
        {
            description: "Enhanced search within individual categories with multi-language support, and available slots",
            inputSchema: z.object({
                term: z.string().describe("Search term"),
                lang: z.string().optional().describe("Language code (default: A)")
            })
        },
        async ({ term, lang = "A" }) => {
            log(`[Tool: search_individual] Called with term='${term}', lang='${lang}'`);
            console.log(`[Tool: search_individual] Called with term='${term}', lang='${lang}'`); 
            try {
                const searchAttempts = [];
                const cleanedTerm = term.replace(/^(دكتور|د\.|doctor|dr\.)\s*/i, "");
                const firstWord = cleanedTerm.split(" ")[0];
                const alternativeLang = lang === "A" ? "E" : "A";
                const nameMapping = {
                    "بسام": "Bassam",
                    "محمد": "Mohammed",
                    "أحمد": "Ahmed",
                    "علي": "Ali",
                    "ريم": "Rima",
                    "اسلام": "إسلام",
                    "قلب": "heart",
                    "Cardio": "heart",
                    "Cardiology": "heart",
                    "كارديولوجي": "heart",
                    "كارديو": "heart",
                    "ear": "E.N.T",
                    "nose": "E.N.T",
                    "throat": "E.N.T",
                    "أنف": "E.N.T",
                    "أذن": "E.N.T",
                    "حنجرة": "E.N.T",
                    "ENT": "E.N.T",
                    "ent": "E.N.T",
                    "NEURO": "NEUROLOGY",
                    "Neuro": "NEUROLOGY",
                    "neurosurgery": "NEUROLOGY"
                };
                const strategies = [
                    { term, lang, description: "البحث الأصلي", priority: 1 },
                    { term, lang: alternativeLang, description: "البحث باللغة الأخرى", priority: 2 },
                    { term: cleanedTerm, lang, description: "البحث بالاسم بدون دكتور", priority: 3 },
                    { term: cleanedTerm, lang, description: "البحث بالاسم بدون طبيب", priority: 4 },
                    { term: cleanedTerm, lang: alternativeLang, description: "البحث بالاسم بدون دكتور باللغة الأخرى", priority: 5 },
                    { term: firstWord, lang, description: "البحث بالاسم الأول فقط", priority: 6 },
                    { term: firstWord, lang: alternativeLang, description: "البحث بالاسم الأول باللغة الأخرى", priority: 7 }
                ];
                if (nameMapping[firstWord]) {
                    strategies.push({
                        term: nameMapping[firstWord],
                        lang: "A",
                        description: `البحث بـ ${nameMapping[firstWord]} للاسم ${firstWord}`,
                        priority: 7
                    });
                }
                console.log(`[Tool: search_individual] Prepared ${strategies.length} search strategies for term='${term}'`);
                const seenDoctors = new Set();
                let searchResults = [];
                const searchPromises = strategies.map(async strategy => {
                    try {
                        const url = `https://salemuatapi.alsalamhosp.com:446/search/individual?term=${encodeURIComponent(strategy.term)}&lang=${strategy.lang}`;
                        const res = await fetchWithTimeout(url);
                        const data = await res.json();
                        return { strategy, data: data.searchResults || [], error: null };
                    } catch (error) {
                        return { strategy, data: [], error: error.message };
                    }
                });
                console.log(`[Tool: search_individual] Initiated ${searchPromises.length} search strategies for term='${term}'`);
                const results = await Promise.all(searchPromises);
                let bestStrategyUsed = null;
                for (const result of results) {
                    searchAttempts.push({
                        strategy: result.strategy.description,
                        term: result.strategy.term,
                        lang: result.strategy.lang,
                        results: result.data.length,
                        error: result.error
                    });
                    if (result.data.length > 0) {
                        if (searchResults.length === 0) {
                            bestStrategyUsed = result.strategy;
                            for (const doctor of result.data) {
                                const key = `${doctor.doctor_id}-${doctor.hospital_id}`;
                                if (!seenDoctors.has(key)) {
                                    seenDoctors.add(key);
                                    searchResults.push(doctor);
                                }
                            }
                            if (result.strategy.priority <= 4) break;
                        } else {
                            if (bestStrategyUsed && bestStrategyUsed.priority <= 4) break;
                            for (const doctor of result.data) {
                                const key = `${doctor.doctor_id}-${doctor.hospital_id}`;
                                if (!seenDoctors.has(key)) {
                                    seenDoctors.add(key);
                                    searchResults.push(doctor);
                                }
                            }
                        }
                    }
                }
                console.log(`[Tool: search_individual] Completed all search strategies. Total unique doctors found: ${searchResults.length}`);
                if (searchResults.length === 0) {
                    return asJsonResponse({
                        success: false,
                        message: "لم يتم العثور على طبيب بهذا الاسم",
                        searchAttempts,
                        suggestions: [
                            "تأكد من كتابة الاسم بشكل صحيح",
                            "جرب البحث بالاسم الأول فقط",
                            "جرب البحث بالإنجليزية إذا كان الاسم إنجليزي",
                            "أو اختر من قائمة الأطباء المتاحين"
                        ],
                        alternativeSearch: "هل تريد البحث في تخصص معين؟"
                    });
                }
                if (searchResults.length > 1) {
                    const doctorsList = searchResults.map((doctor, index) => ({
                        doctor_id: doctor.doctor_id,
                        doctor_name: doctor.doctor_name,
                        specialty_name: doctor.specialty_name,
                        hospital_name: doctor.hospital_name,
                        hospital_id: doctor.hospital_id,
                        specialty_id: doctor.specialty_id,
                        clinic_id: doctor.clinic_id,
                        index: index + 1
                    }));
                    return asJsonResponse({
                        success: true,
                        multiple_doctors: true,
                        doctors: doctorsList,
                        searchResults,
                        total_count: searchResults.length,
                        searchAttempts,
                        message: `تم العثور على ${searchResults.length} أطباء بهذا الاسم. يرجى اختيار الطبيب المطلوب من القائمة.`
                    });
                }
                const doctor = searchResults[0];
                log(`[Tool: search_individual] Single doctor found: ${doctor.doctor_name}, checking slots...`);
                console.log(`[Tool: search_individual] Single doctor found: ${doctor.doctor_name}, checking slots...`);
                let availableSlots = null;
                let availabilityType = null;
                const prioritizedClinicIds = Array.isArray(doctor.clinic_id)
                    ? doctor.clinic_id.filter(Boolean)
                    : [doctor.clinic_id].filter(Boolean);
                const formattedDate = formatDateDDMMYYYY(new Date());
                const slotsPromises = prioritizedClinicIds.map(async clinicId => {
                    try {
                        const slotsResponse = await fetchWithTimeout(
                            `https://salemuatapi.alsalamhosp.com:446/get_doc_next_availble_slot?BRANCH_ID=${doctor.hospital_id}&DOC_ID=${doctor.doctor_id}&CLINIC_ID=${clinicId}&SCHEDULE_DAYS_ONLY=1&Web_FromDate=${formattedDate}&mobileapp_whatsapp=2`,
                            {},
                            120000
                        );
                        const slotsData = await slotsResponse.json();
                        const hasHourSlots = slotsData.Root && slotsData.Root.HOURS_SLOTS;
                        const hasDocDays = slotsData.Root && slotsData.Root.DOC_DAYS && slotsData.Root.DOC_DAYS.DOC_DAYS_ROW;
                        if (hasHourSlots) return { success: true, type: "slots", data: slotsData, clinicId };
                        if (hasDocDays) return { success: true, type: "days", data: slotsData, clinicId };
                        return { success: false, type: null, data: slotsData, clinicId };
                    } catch (error) {
                        console.error(`[Tool: search_individual] Error fetching slots for clinic ${clinicId}: ${error.message}`);
                        return { success: false, type: null, data: null, clinicId, error: error.message };
                    }
                });

                const slotsResults = await Promise.all(slotsPromises);
                const successfulSlot = slotsResults.find(result => result.success);
                if (successfulSlot) {
                    availableSlots = successfulSlot.data;
                    availabilityType = successfulSlot.type;
                }
                return asJsonResponse({
                    success: true,
                    single_doctor: true,
                    doctor: {
                        id: doctor.doctor_id,
                        name: doctor.doctor_name,
                        specialty: doctor.specialty_name,
                        hospital: doctor.hospital_name,
                        hospital_id: doctor.hospital_id,
                        specialty_id: doctor.specialty_id,
                        clinic_id: doctor.clinic_id
                    },
                    available_slots: availableSlots,
                    available_slots_type: availabilityType,
                    searchAttempts,
                    message: (() => {
                        if (!availableSlots) return "No available slots or days were returned for this doctor.";
                        if (availabilityType === "slots" && availableSlots.Root?.next_available_time) {
                            return `Found next available slot at ${availableSlots.Root.next_available_time}.`;
                        }
                        if (availabilityType === "days") {
                            const rows = availableSlots.Root?.DOC_DAYS?.DOC_DAYS_ROW;
                            const count = Array.isArray(rows) ? rows.length : rows ? 1 : 0;
                            return `Found ${count} upcoming schedule day(s) for this doctor.`;
                        }
                        return "Availability data returned but could not be interpreted.";
                    })()
                });
            } catch (error) {
                console.error(`[Tool: search_individual] Error: ${error.message}`);
                return asJsonResponse({
                    success: false,
                    error: error.message,
                    message: "حدث خطأ أثناء البحث عن الطبيب"
                });
            }
        }
    );

    // Register search_bio tool
    server.registerTool(
        "search_bio",
        {
            description: "Search in doctor bio",
            inputSchema: z.object({
                term: z.string().describe("Search term (doctor bio)"),
                lang: z.string().optional().describe("Language code (default: A)")
            })
        },
        async ({ term, lang = "A" }) => {
            log(`[Tool: search_bio] Called with term='${term}', lang='${lang}'`);
            console.log(`[Tool: search_bio] Called with term='${term}', lang='${lang}'`);
            try {
                const response = await fetchWithTimeout(`https://salemuatapi.alsalamhosp.com:446/search/bio?term=${encodeURIComponent(term)}&lang=${lang}`);
                const data = await response.json();
                return asJsonResponse({
                    success: true,
                    term,
                    lang,
                    results: data
                });
            } catch (error) {
                console.error(`[Tool: search_bio] Error: ${error.message}`);
                return asJsonResponse({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Register search_bio_all tool
    server.registerTool(
        "search_bio_all",
        {
            description: "Search in doctor bio all",
            inputSchema: z.object({
                term: z.string().describe("Search term (doctor bio)"),
                lang: z.string().optional().describe("Language code (default: A)")
            })
        },
        async ({ term, lang = "A" }) => {
            log(`[Tool: search_bio_all] Called with term='${term}', lang='${lang}'`);
            console.log(`[Tool: search_bio_all] Called with term='${term}', lang='${lang}'`);
            try {
                const response = await fetchWithTimeout(`https://salemuatapi.alsalamhosp.com:446/search/bio_all?term=${encodeURIComponent(term)}&lang=${lang}`);
                const data = await response.json();
                return asJsonResponse({
                    success: true,
                    term,
                    lang,
                    results: data
                });
            } catch (error) {
                console.error(`[Tool: search_bio_all] Error: ${error.message}`);
                return asJsonResponse({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Register get_doc_next_availble_slot tool
    server.registerTool(
        "get_doc_next_availble_slot",
        {
            description: "Get the next available slot for a doctor",
            inputSchema: z.object({
                branchId: z.string().describe("Branch ID"),
                clinicId: z.string().describe("Clinic ID"),
                docId: z.string().describe("Doctor ID"),
                scheduleDaysOnly: z.string().describe("1 for days only, 0 for slots"),
                webFromDate: z.string().optional().describe("Date in DD/MM/YYYY format"),
                mobileAppWhatsapp: z.string().optional().default("2").describe("Mobile app/Whatsapp flag")
            })
        },
        async ({ branchId, clinicId, docId, scheduleDaysOnly, webFromDate, mobileAppWhatsapp = "2" }) => {
            log(`[Tool: get_doc_next_availble_slot] Called for DocID=${docId}, ClinicID=${clinicId}`);
            console.log(`[Tool: get_doc_next_availble_slot] Called for DocID=${docId}, ClinicID=${clinicId}`);
            try {
                const todayDate = new Date();
                todayDate.setHours(0, 0, 0, 0);
                let normalizedDate = webFromDate?.trim();
                if (normalizedDate) {
                    const [d, m, y] = normalizedDate.split("/").map(Number);
                    const parsed = new Date(y, (m || 1) - 1, d || 1);
                    parsed.setHours(0, 0, 0, 0);
                    if (!Number.isFinite(parsed.getTime()) || parsed < todayDate) {
                        normalizedDate = formatDateDDMMYYYY(todayDate);
                    } else {
                        normalizedDate = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
                    }
                } else {
                    normalizedDate = formatDateDDMMYYYY(todayDate);
                }
                const queryParts = [
                    `BRANCH_ID=${branchId}`,
                    `CLINIC_ID=${clinicId}`,
                    `DOC_ID=${docId}`,
                    `SCHEDULE_DAYS_ONLY=${scheduleDaysOnly}`,
                    `mobileapp_whatsapp=${mobileAppWhatsapp}`
                ];
                if (normalizedDate) queryParts.push(`Web_FromDate=${normalizedDate}`);
                const url = `https://salemuatapi.alsalamhosp.com:446/get_doc_next_availble_slot?${queryParts.join("&")}`;
                const response = await fetchWithTimeout(url);
                const data = await response.json();
                log(`[Tool: get_doc_next_availble_slot] Response status: ${response.status}, dataPreview=${previewText(data)}`);
                return asJsonResponse({
                    success: true,
                    request: { branchId, clinicId, docId, scheduleDaysOnly, webFromDate: normalizedDate, mobileAppWhatsapp },
                    data
                });
            } catch (error) {
                console.error(`[Tool: get_doc_next_availble_slot] Error: ${error.message}`);
                return asJsonResponse({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Register check_patient_whatsapp tool
console.log(`[Tool: 0x check_patient_whatsapp] Registering tool...`);
 
server.registerTool(
    "check_patient_whatsapp",
    {
        description: "Check if a patient exists and has multiple profiles by mobile number",
        inputSchema: z.object({
            mobile: z.string().describe("Patient's mobile number (e.g., +965...)")
        })
    },
    // ✅ THIRD PARAM: ONLY the async handler function (no console.log here!)
    async ({ mobile }) => {
        console.log(`[Tool: check_patient_whatsapp] Checking mobile=${mobile}`);
        
        try {
            const endpoints = [
                'https://salemuatapi.alsalamhosp.com:446/checkPatientWhatsApp',
                'https://patientmobapp.alsalamhosp.com/WhatsAppAPI/api/checkPatientWhatsApp'
            ];
            const attempts = [];

            for (const endpoint of endpoints) {
                try {
                    const response = await fetchWithTimeout(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mobile })
                    });

                    const contentType = response.headers.get('content-type') || '';
                    const rawBody = await response.text();
                    let data = null;

                    if (rawBody.trim()) {
                        try {
                            data = JSON.parse(rawBody);
                        } catch (parseError) {
                            attempts.push({
                                endpoint,
                                status: response.status,
                                contentType,
                                error: `Invalid JSON response: ${parseError.message}`,
                                bodyPreview: rawBody.slice(0, 200)
                            });
                            continue;
                        }
                    }

                    if (!response.ok) {
                        attempts.push({
                            endpoint,
                            status: response.status,
                            contentType,
                            error: data?.message || `HTTP ${response.status}`,
                            bodyPreview: rawBody.slice(0, 200)
                        });
                        continue;
                    }

                    console.log(`[Tool: check_patient_whatsapp] Response status: ${response.status} via ${endpoint}`);

                    const result = asJsonResponse({
                        success: true,
                        mobile,
                        data,
                        endpoint,
                        status: response.status
                    });
                    
                    log(`[Tool: check_patient_whatsapp] Returning success (status=${response.status}, endpoint=${endpoint})`);
                    return result;
                } catch (endpointError) {
                    attempts.push({
                        endpoint,
                        error: endpointError.message
                    });
                }
            }

            const errorResponse = asJsonResponse({
                success: false,
                error: 'All checkPatientWhatsApp endpoints failed',
                mobile,
                attempts
            });

            warn(`[Tool: check_patient_whatsapp] Returning endpoint-failure response for mobile=${mobile}`);
            return errorResponse;
            
        } catch (error) {
            console.error(`[Tool: check_patient_whatsapp] Error: ${error.message}`);
            
            const errorResponse = asJsonResponse({
                success: false,
                error: error.message
            });
            
            warn(`[Tool: check_patient_whatsapp] Returning exception response for mobile=${mobile}`);
            return errorResponse;  // ✅ return INSIDE catch block = valid
        }
    }  // ✅ Handler function ends here
);  // ✅ server.registerTool() call ends here

    // Register select_doctor_from_list tool
    server.registerTool(
        "select_doctor_from_list",
        {
            description: "Select a specific doctor from multiple search results and get their available days",
            inputSchema: z.object({
                doctorIndex: z.number().describe("Index of the selected doctor (1-based)"),
                searchResults: z.array(z.object({
                    doctor_id: z.string(),
                    doctor_name: z.string(),
                    specialty_id: z.string(),
                    specialty_name: z.string(),
                    hospital_id: z.string(),
                    hospital_name: z.string(),
                    clinic_id: z.string().describe("Clinic ID from search results - REQUIRED")
                })).describe("Array of doctors from search results")
            })
        },
        async ({ doctorIndex, searchResults }) => {
            log(`[Tool: select_doctor_from_list] Selecting index=${doctorIndex}`);
            console.log(`[Tool: select_doctor_from_list] Selecting index=${doctorIndex} from ${searchResults.length} results`);
            try {
                if (doctorIndex < 1 || doctorIndex > searchResults.length) {
                    return asJsonResponse({
                        success: false,
                        message: `Invalid number. Please choose a number between 1 and ${searchResults.length}`,
                        available_doctors: searchResults.length
                    });
                }
                const selectedDoctor = searchResults[doctorIndex - 1];
                const cacheKey = `${selectedDoctor.hospital_id}:${selectedDoctor.doctor_id}:${selectedDoctor.clinic_id}`;
                let availableDays = [];
                const cached = daysCache.get(cacheKey);
                if (cached && Date.now() - cached.timestamp < DAYS_CACHE_TTL_MS) {
                    availableDays = cached.availableDays;
                } else {
                    const fromDate = formatDateDDMMYYYY(new Date());
                    const url = `https://salemuatapi.alsalamhosp.com:446/get_doctor_available_days?BRANCH_ID=${selectedDoctor.hospital_id}&DOC_ID=${selectedDoctor.doctor_id}&CLINIC_ID=${selectedDoctor.clinic_id}&SCHEDULE_DAYS_ONLY=1&Web_FromDate=${fromDate}&mobileapp_whatsapp=2`;
                    try {
                        const resp = await fetchWithTimeout(url, {}, 120000);
                        const daysData = await resp.json();
                        if (daysData.Root?.DOC_DAYS?.DOC_DAYS_ROW) {
                            availableDays = Array.isArray(daysData.Root.DOC_DAYS.DOC_DAYS_ROW)
                                ? daysData.Root.DOC_DAYS.DOC_DAYS_ROW
                                : [daysData.Root.DOC_DAYS.DOC_DAYS_ROW];
                            daysCache.set(cacheKey, { timestamp: Date.now(), availableDays });
                            pruneDaysCache();
                        }
                    } catch (error) {
                        console.error(`[Tool: select_doctor_from_list] Error fetching days: ${error.message}`);
                    }
                }
                console.log(`[Tool: select_doctor_from_list] Doctor ${selectedDoctor.doctor_name} has ${availableDays.length} available days`);
                return asJsonResponse({
                    success: availableDays.length > 0,
                    doctor: {
                        id: selectedDoctor.doctor_id,
                        name: selectedDoctor.doctor_name,
                        specialty: selectedDoctor.specialty_name,
                        hospital: selectedDoctor.hospital_name,
                        hospital_id: selectedDoctor.hospital_id,
                        specialty_id: selectedDoctor.specialty_id,
                        clinic_id: selectedDoctor.clinic_id
                    },
                    available_days: availableDays,
                    message: availableDays.length > 0
                        ? `Selected Dr. ${selectedDoctor.doctor_name} (${selectedDoctor.specialty_name}) at ${selectedDoctor.hospital_name}. Available days: ${availableDays.length}`
                        : `Doctor selected but no available days found. This may be because clinic_id is ${selectedDoctor.clinic_id}. Please try another doctor.`
                });
            } catch (error) {
                console.error(`[Tool: select_doctor_from_list] Fatal Error: ${error.message}`);
                return asJsonResponse({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Register generate_otp tool
    server.registerTool(
        "generate_otp",
        {
            description: "Generate OTP for existing patient verification",
            inputSchema: z.object({
                mobile: z.string().describe("Patient's mobile number with country code")
            })
        },
        async ({ mobile }) => {
            log(`[Tool: generate_otp] Generating OTP for ${mobile}`);
            try {
                const cleanMobile = mobile.startsWith('+') ? mobile.substring(1) : mobile;
                const response = await fetchWithTimeout(`https://salemuatapi.alsalamhosp.com:446/otp/generate?mobile=${encodeURIComponent(cleanMobile)}&source=WhatsApp`, {
                    method: 'POST'
                });
                const data = await response.json();
                console.log(`[Tool: generate_otp] OTP generation response status: ${response.status}, data:`, data);
                return asJsonResponse({
                    success: data.success,
                    message: data.message,
                    otp: data.otp,
                    mobile
                });
            } catch (error) {
                console.error(`[Tool: generate_otp] Error: ${error.message}`);
                return asJsonResponse({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Register verify_otp tool
    server.registerTool(
        "verify_otp",
        {
            description: "Verify OTP for existing patient verification",
            inputSchema: z.object({
                mobile: z.string().describe("Patient's mobile number with country code"),
                otpCode: z.string().describe("OTP code entered by patient")
            })
        },
        async ({ mobile, otpCode }) => {
            log(`[Tool: verify_otp] Verifying OTP for ${mobile}`);
            try {
                const cleanMobile = mobile.startsWith('+') ? mobile.substring(1) : mobile;
                const response = await fetchWithTimeout(
                    `https://salemuatapi.alsalamhosp.com:446/otp/verify?mobile=${encodeURIComponent(cleanMobile)}&source=WhatsApp`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ otpCode })
                    }
                );
                console.log(`[Tool: verify_otp] OTP verification response status: ${response.status}`);
                const data = await response.json();
                const isVerified = data.success && data.otpCode === otpCode;
                return asJsonResponse({
                    success: isVerified,
                    message: isVerified ? "OTP verified successfully" : "OTP verification failed",
                    verified: isVerified,
                    mobile
                });
            } catch (error) {
                console.error(`[Tool: verify_otp] Error: ${error.message}`);
                return asJsonResponse({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Register submit_appointment tool
    server.registerTool(
        "submit_appointment",
        {
            description: "Submit a new appointment booking",
            inputSchema: z.object({
                servType: z.string().describe("Service type"),
                branchId: z.string().describe("Branch ID"),
                clinicId: z.string().describe("Clinic ID"),
                specialtyId: z.string().optional().describe("Specialty ID"),
                docId: z.string().describe("Doctor ID"),
                schedSerial: z.string().describe("Schedule serial number"),
                shiftId: z.string().describe("Shift ID"),
                dateDone: z.string().describe("Appointment date and time (DD/MM/YYYY HH:mm:ss)"),
                expectedEndDate: z.string().describe("Expected end date and time (DD/MM/YYYY HH:mm:ss)"),
                patTel: z.string().describe("Patient telephone number"),
                telephoneCountryCode: z.string().describe("Telephone country code (e.g., +965)"),
                patientId: z.string().optional().describe("Patient ID (for registered patients)"),
                patName: z.string().optional().describe("Patient full name (for non-registered patients)"),
                gender: z.string().optional().describe("Patient gender (M/F)"),
                bufferStatus: z.string().optional().describe("Buffer status (default: 1)"),
                init: z.string().optional().describe("Init value (default: 1)"),
                computerName: z.string().optional().describe("Computer name (default: whatsapp)")
            })
        },
        async args => {
            const {
                servType,
                branchId,
                clinicId,
                specialtyId,
                docId,
                schedSerial,
                shiftId,
                dateDone,
                expectedEndDate,
                patTel,
                telephoneCountryCode,
                patientId,
                patName,
                gender,
                bufferStatus = "1",
                init = "1",
                computerName = "whatsapp"
            } = args;
            const normalizedPatientId = typeof patientId === "string" && patientId.trim() !== "6849"
                ? patientId.trim()
                : "";
            const normalizedPatName = typeof patName === "string" ? patName.trim() : "";
            const normalizedGender = typeof gender === "string" ? gender.trim() : "";
            const bookingLabel = normalizedPatName || normalizedPatientId || "unknown-patient";

            console.log(`[Tool: submit_appointment] Received appointment submission request for ${bookingLabel} with DocID=${docId}`);
            log(`[Tool: submit_appointment] Submitting appointment for ${bookingLabel} with DocID=${docId}`);
            try {
                const appointmentData = {
                    SERV_TYPE: servType,
                    buffer_status: bufferStatus,
                    INIT: init,
                    COMPUTER_NAME: computerName,
                    BRANCH_ID: branchId,
                    CLINIC_ID: clinicId,
                    DOC_ID: docId,
                    SCHED_SERIAL: schedSerial,
                    SHIFT_ID: shiftId,
                    dateDone,
                    EXPECTED_END_DATE: expectedEndDate,
                    PAT_TEL: patTel,
                    PATIENT_ID: normalizedPatientId || "",
                    PAT_NAME: normalizedPatName || "",
                    GENDER: normalizedGender || "",
                    TELEPHONE_COUNTRY_CODE: telephoneCountryCode
                };
                console.log(`[Tool: submit_appointment] Base appointment data:`, appointmentData);
                if (specialtyId) appointmentData.SPECIALTY_ID = specialtyId;
                console.log(`[Tool: submit_appointment] Final appointment data to submit:`, appointmentData);
                const response = await fetchWithTimeout('https://salemuatapi.alsalamhosp.com:446/submit_appointment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(appointmentData)
                });
                const data = await response.json();
                console.log(`[Tool: submit_appointment] Appointment submission response for ${bookingLabel}:`, data);
                return asJsonResponse({
                    success: true,
                    request: appointmentData,
                    response: data
                });
            } catch (error) {
                console.error(`[Tool: submit_appointment] Error: ${error.message}`);
                return asJsonResponse({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    // Register send_whatsapp_message tool
   // 9. send_whatsapp_message

 server.registerTool(
  "send_whatsapp_message",
  {
    description: "Send WhatsApp appointment booking confirmation to patient",
    inputSchema: z.object({
      patient_mobile: z.string().describe("Patient mobile number with country code"),
      patient_name: z.string().describe("Patient full name"),
      branch_name: z.string().describe("Branch name"),
      clinic_name: z.string().describe("Clinic name"),
      doctor_name: z.string().describe("Doctor name"),
      appointment_date: z.string().describe("Appointment date (DD/MM/YYYY)"),
      appointment_day: z.string().describe("Appointment day"),
      appointment_time: z.string().describe("Appointment time"),
      languageCode: z.string().optional().default("ar"),
      imageUrl: z.string().optional(),
      mediaUrl: z.string().optional(),
      documentUrl: z.string().optional(),
      fileName: z.string().optional()
    })
  },

  async (args) => {
    const {
      patient_mobile,
      patient_name,
      branch_name,
      clinic_name,
      doctor_name,
      appointment_date,
      appointment_day,
      appointment_time,
      languageCode,
      imageUrl,
      mediaUrl,
      documentUrl,
      fileName
    } = args;
    let normalizedLanguage = "en"; // Default to English

  if (languageCode) {
    const lang = languageCode.toLowerCase();

    if (lang === "A" || lang === "ar") {
      normalizedLanguage = "ar";
    } else if (lang === "E" || lang === "en") {
      normalizedLanguage = "en";
    }
  }
    console.log(
      `[Tool: send_whatsapp_message] Request for ${patient_name} (${patient_mobile})`
    );

    log(`[Tool: send_whatsapp_message] Preparing WhatsApp message`);

    try {

      const whatsappPayload = {
        patient_mobile,
        msg_key: "book_app_info",
        languageCode: normalizedLanguage,
        variables: {
          "1": patient_name,
          "2": branch_name,
          "3": clinic_name,
          "4": doctor_name,
          "5": appointment_date,
          "6": appointment_day,
          "7": appointment_time
        },

        fileName: null,
        imageUrl: null,
        mediaUrl: null
      };

      if (documentUrl) {
        whatsappPayload.documentUrl = documentUrl;
      }

      console.log(
        `[Tool: send_whatsapp_message] Sending payload`,
        whatsappPayload
      );

      const response = await fetchWithTimeout(
        "https://salemuatapi.alsalamhosp.com:446/send-whatsapp",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(whatsappPayload)
        }
      );

      const data = await response.json();

      console.log(
        `[Tool: send_whatsapp_message] WhatsApp API response`,
        data
      );

      return asJsonResponse({
        success: true,
        request: whatsappPayload,
        response: data,
        message: "WhatsApp message queued for delivery"
      });

    } catch (error) {

      console.error(
        `[Tool: send_whatsapp_message] Error: ${error.message}`
      );

      log(
        `[Tool: send_whatsapp_message] Failed to send WhatsApp message`
      );

      return asJsonResponse({
        success: false,
        error: error.message,
        patient_mobile,
        patient_name
      });
    }
  }
);

    return server;
};

// Map to store transports by session ID
const transports = {};

// Handle OPTIONS preflight requests for /mcp endpoint
app.options('/mcp', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version, Last-Event-ID');
    res.header('Access-Control-Expose-Headers', 'mcp-session-id');
    res.header('Access-Control-Max-Age', '86400');
    res.sendStatus(200);
});

// MCP POST endpoint - handles JSON-RPC requests
app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    
    // Set CORS headers explicitly
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version, Last-Event-ID');
    res.header('Access-Control-Expose-Headers', 'mcp-session-id');
    
    console.log(`[MCP] POST request received`);
    if (sessionId) {
        console.log(`[MCP] Session ID: ${sessionId}`);
    }
    console.log(`[MCP] Client IP: ${clientIp}`);
    log(`[MCP] Headers preview: ${previewText(req.headers)}`);
    if (typeof req.rawBodySize === "number") {
        log(`[MCP] Body size: ${req.rawBodySize} bytes`);
    }
    log(`[MCP] Body preview: ${req.rawBodyPreview || previewText(req.body)}`);
    
    try {
        let transport;
        
        if (sessionId && transports[sessionId]) {
            // Reuse existing transport for this session
            console.log(`[MCP] Reusing transport for session: ${sessionId}`);
            transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
            // New initialization request - create new transport and session
            console.log(`[MCP] New initialization request, creating transport`);
            
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => {
                    // Store the transport by session ID when session is initialized
                    console.log(`[MCP] Session initialized with ID: ${sid}`);
                    transports[sid] = transport;
                }
            });
            
            // Set up onclose handler to clean up transport when closed
            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && transports[sid]) {
                    console.log(`[MCP] Transport closed for session ${sid}, removing from transports map`);
                    delete transports[sid];
                }
            };
            
            // Create a new server instance and connect it to this transport
            // Each session gets its own server instance
            const server = createServer();
            await server.connect(transport);
            
            // Handle the initialization request
            await transport.handleRequest(req, res, req.body);
            return; // Already handled
        } else {
            // Invalid request - no session ID or not initialization request
            console.warn(`[MCP] Invalid request - sessionId: ${sessionId}, isInitialize: ${isInitializeRequest(req.body)}`);
            return res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Bad Request: No valid session ID provided or invalid initialization request'
                },
                id: req.body?.id ?? null
            });
        }
        
        // Handle the request with existing transport
        // The transport is already connected to a server instance
        await transport.handleRequest(req, res, req.body);
        console.log(`[MCP] Request handled successfully`);
    } catch (error) {
        console.error(`[MCP] Error handling request:`, error);
        console.error(`[MCP] Error stack:`, error.stack);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                id: req.body?.id ?? null,
                error: {
                    code: -32603,
                    message: `Internal error: ${error.message}`
                }
            });
        }
    }
});

// GET endpoint for SSE streaming
app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    
    console.log(`[MCP] GET request received (SSE stream)`);
    if (sessionId) {
        console.log(`[MCP] Session ID: ${sessionId}`);
    }
    
    if (!sessionId || !transports[sessionId]) {
        console.warn(`[MCP] Invalid or missing session ID for GET request: ${sessionId}`);
        return res.status(400).json({
            error: 'Invalid or missing session ID',
            message: 'A valid mcp-session-id header is required for SSE connections'
        });
    }
    
    // Check for Last-Event-ID header for resumability
    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
        console.log(`[MCP] Client reconnecting with Last-Event-ID: ${lastEventId}`);
    } else {
        console.log(`[MCP] Establishing new SSE stream for session ${sessionId}`);
    }
    
    try {
        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
    } catch (error) {
        console.error(`[MCP] GET Error:`, error);
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }
});

// DELETE endpoint for session termination
app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    
    console.log(`[MCP] DELETE request received (session termination)`);
    if (sessionId) {
        console.log(`[MCP] Session ID: ${sessionId}`);
    }
    
    if (!sessionId || !transports[sessionId]) {
        console.warn(`[MCP] Invalid or missing session ID for DELETE request: ${sessionId}`);
        return res.status(400).json({
            error: 'Invalid or missing session ID',
            message: 'A valid mcp-session-id header is required for session termination'
        });
    }
    
    console.log(`[MCP] Terminating session: ${sessionId}`);
    try {
        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
    } catch (error) {
        console.error(`[MCP] DELETE Error:`, error);
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Error processing session termination',
                message: error.message
            });
        }
    }
});

// Config endpoint - returns server configuration
app.get('/config', (req, res) => {
    res.json({
        server: {
            name: 'AlSalamHospital_StreamableHTTP',
            version: '1.0.0',
            transport: 'Streamable HTTP',
            protocolVersion: '2024-11-05'
        },
        endpoints: {
            mcp: '/mcp',
            webhook: '/webhook',
            health: '/health',
            config: '/config'
        },
        activeSessions: Object.keys(transports).length
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        server: 'AlSalamHospital_StreamableHTTP',
        version: '1.0.0',
        transport: 'Streamable HTTP',
        endpoint: '/mcp',
        webhook: '/webhook',
        activeSessions: Object.keys(transports).length
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'AlSalam Hospital MCP Server (Streamable HTTP)',
        version: '1.0.0',
        endpoints: {
            mcp: '/mcp',
            webhook: '/webhook',
            health: '/health',
            config: '/config'
        },
        server: 'AlSalamHospital_StreamableHTTP'
    });
});

// Start server - supports both HTTP and HTTPS modes
const DEFAULT_CERT_PATH = "certs/wildcard_alsalamhosp_com.crt";
const DEFAULT_KEY_PATH = "certs/wildcard_alsalamhosp_com.key";
const certPath = process.env.SSL_CERT_FILE || DEFAULT_CERT_PATH;
const keyPath = process.env.SSL_KEY_FILE || DEFAULT_KEY_PATH;
const USE_HTTP = process.env.USE_HTTP === "true" || process.env.USE_HTTP === "1";
const bindHost = "0.0.0.0";
const port = Number(process.env.PORT || process.env.MCP_PORT || (USE_HTTP ? 3000 : 443));
let httpsServer = null;
let httpServer = null;
let isShuttingDown = false;
let dailyRestartTimer = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function msUntilNextMidnightInTimezone(timeZone) {
    const now = new Date();
    const tzNow = new Date(now.toLocaleString("en-US", { timeZone }));
    const tzNextMidnight = new Date(tzNow);
    tzNextMidnight.setHours(24, 0, 0, 0);
    return Math.max(1000, tzNextMidnight.getTime() - tzNow.getTime());
}

function scheduleDailyMidnightRestart() {
    const delay = msUntilNextMidnightInTimezone(KUWAIT_TIMEZONE);
    const hours = Math.floor(delay / 3_600_000);
    const minutes = Math.floor((delay % 3_600_000) / 60_000);
    const seconds = Math.floor((delay % 60_000) / 1000);
    log(`[Restart] Next daily restart scheduled at 12:00 AM (${KUWAIT_TIMEZONE}) in ${hours}h ${minutes}m ${seconds}s`);
    dailyRestartTimer = setTimeout(async () => {
        warn(`[Restart] Daily scheduled restart triggered at 12:00 AM (${KUWAIT_TIMEZONE})`);
        await gracefulShutdown(RESTART_REQUEST_EXIT_CODE, "daily-midnight-kuwait");
    }, delay);
    dailyRestartTimer.unref();
}

async function gracefulShutdown(exitCode = 0, reason = "signal") {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log(`[Shutdown] Starting shutdown (reason=${reason}, exitCode=${exitCode})`);

    if (dailyRestartTimer) clearTimeout(dailyRestartTimer);
    clearInterval(memoryLogInterval);

    for (const sessionId in transports) {
        try {
            log(`[Shutdown] Closing transport for session ${sessionId}`);
            await transports[sessionId].close();
            delete transports[sessionId];
        } catch (shutdownError) {
            errorLog(`[Shutdown] Error closing transport for session ${sessionId}: ${shutdownError.message}`);
        }
    }

    if (httpsServer) {
        await new Promise((resolve) => httpsServer.close(resolve));
    }
    if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
    }

    try {
        await agent.destroy();
    } catch (destroyError) {
        errorLog(`[Shutdown] Error destroying agent: ${destroyError.message}`);
    }

    log(`[Shutdown] Completed (reason=${reason})`);
    process.exit(exitCode);
}

function installFatalHandlers() {
    process.on("uncaughtException", async (err) => {
        errorLog(`[Fatal] uncaughtException: ${err?.stack || err?.message || err}`);
        await gracefulShutdown(FATAL_ERROR_EXIT_CODE, "uncaughtException");
    });
    process.on("unhandledRejection", async (reason) => {
        errorLog(`[Fatal] unhandledRejection: ${previewText(reason)}`);
        await gracefulShutdown(FATAL_ERROR_EXIT_CODE, "unhandledRejection");
    });
}

function startServerRuntime() {
    installFatalHandlers();
    scheduleDailyMidnightRestart();

    if (USE_HTTP) {
        log("Starting server in HTTP mode (no SSL certificates required)");
        httpServer = app.listen(port, bindHost, () => {
            log(`MCP Streamable HTTP Server ready at http://${bindHost}:${port}`);
            log(`MCP endpoint: http://${bindHost}:${port}/mcp`);
            log(`Health check: http://${bindHost}:${port}/health`);
        });
        return;
    }

    try {
        const cert = fs.readFileSync(path.resolve(__dirname, certPath));
        const key = fs.readFileSync(path.resolve(__dirname, keyPath));
        httpsServer = https.createServer({ cert, key }, app);
        httpsServer.listen(port, bindHost, () => {
            log(`MCP Streamable HTTP Server ready at https://${bindHost}:${port}`);
            log(`MCP endpoint: https://${bindHost}:${port}/mcp`);
            log(`Health check: https://${bindHost}:${port}/health`);
        });
    } catch (certError) {
        warn(`Failed to load SSL certificates: ${certError.message}`);
        warn("Falling back to HTTP mode");
        httpServer = app.listen(port, bindHost, () => {
            log(`MCP Streamable HTTP Server ready at http://${bindHost}:${port}`);
            log(`MCP endpoint: http://${bindHost}:${port}/mcp`);
            log(`Health check: http://${bindHost}:${port}/health`);
        });
    }
}

function startSupervisor() {
    log("[Supervisor] Enabled. Parent process will restart child on crash/exit.");
    let child = null;
    let stopping = false;
    let restartCount = 0;

    const launchChild = (trigger) => {
        if (stopping) return;
        const childEnv = { ...process.env, MCP_SUPERVISOR_CHILD: "1" };
        child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
            stdio: "inherit",
            env: childEnv
        });
        log(`[Supervisor] Child started pid=${child.pid} trigger=${trigger} restartCount=${restartCount}`);

        child.on("exit", async (code, signal) => {
            const childCode = code ?? -1;
            const childSignal = signal || "none";
            warn(`[Supervisor] Child exited code=${childCode} signal=${childSignal}`);
            if (stopping) return;
            restartCount += 1;
            await sleep(1500);
            launchChild(`exit_code_${childCode}`);
        });
    };

    process.on("SIGTERM", async () => {
        stopping = true;
        warn("[Supervisor] SIGTERM received, stopping child and exiting");
        if (child && !child.killed) child.kill("SIGTERM");
        await sleep(500);
        process.exit(0);
    });

    launchChild("initial");
}

if (ENABLE_INTERNAL_SUPERVISOR && !IS_SUPERVISOR_CHILD) {
    startSupervisor();
} else {
    startServerRuntime();

    process.on("SIGINT", async () => {
        await gracefulShutdown(0, "SIGINT");
    });

    process.on("SIGTERM", async () => {
        await gracefulShutdown(0, "SIGTERM");
    });
}
