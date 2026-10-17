import type { GetServerSideProps } from "next";
import Head from "next/head";

// Public page the doctor card's QR code points to: shows the selected
// doctor's bio and photo, fetched server-side from the hospital's own
// bio_all endpoint (the same data the agent's search_bio_all tool returns).
// That endpoint searches bio *content* by keyword, not by doctor, so the QR
// carries the keyword the agent searched with plus the doctor_id to pick the
// right entry out of the results.

const HOSPITAL_API_BASE = (
  process.env.ALSALAM_RAW_API_BASE || "https://salemuatapi.alsalamhosp.com:446"
).replace(/\/+$/, "");

type Doctor = {
  name: string;
  specialty: string;
  hospital: string;
  imageUrl: string;
  bioLines: string[];
};

type Props = { doctor: Doctor | null; lang: "A" | "E" };

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&bull;": "",
};

// Same cleanup as clean_doctor_bio() in the agent: bios mix real HTML and
// literal "\n" + "- " bullets, so reduce both to plain lines of text.
function cleanBio(raw: string): string[] {
  if (!raw) return [];
  let text = raw.replace(/\\n/g, "\n");
  text = text.replace(/<\s*(br|li)\s*\/?\s*>/gi, "\n");
  text = text.replace(/<\/\s*(div|p|ul)\s*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
  text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return text
    .split("\n")
    .map((line) => line.replace(/^[\s•\-\t]+|[\s•\-\t]+$/g, ""))
    .filter(Boolean);
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ query, res }) => {
  const id = String(query.id ?? "");
  const term = String(query.term ?? "").slice(0, 80);
  const lang = query.lang === "E" ? "E" : "A";
  if (!/^\d{1,12}$/.test(id) || !term) {
    return { props: { doctor: null, lang } };
  }

  try {
    const url = `${HOSPITAL_API_BASE}/search/bio_all?term=${encodeURIComponent(term)}&lang=${lang}`;
    // The newer hospital API (salemavatar.alsalamhosp.com/api) needs its key.
    const key = process.env.ALSALAM_RAW_API_KEY;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: key ? { "X-API-Key": key } : undefined,
    });
    const body = await resp.json();
    const match = (body?.searchResults ?? []).find(
      (r: { doctor_id?: number | string }) => String(r.doctor_id) === id,
    );
    if (!match) return { props: { doctor: null, lang } };

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return {
      props: {
        lang,
        doctor: {
          name: match.doctor_name ?? "",
          specialty: match.specialty_name ?? "",
          hospital: match.hospital_name ?? "",
          imageUrl: match.doctor_image ?? "",
          bioLines: cleanBio(match.doctor_bio ?? ""),
        },
      },
    };
  } catch {
    return { props: { doctor: null, lang } };
  }
};

export default function DoctorPage({ doctor, lang }: Props) {
  const rtl = lang === "A";
  return (
    <>
      <Head>
        <title>{doctor?.name || (rtl ? "معلومات الطبيب" : "Doctor information")}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main
        dir={rtl ? "rtl" : "ltr"}
        className="min-h-screen bg-gray-950 text-gray-200 px-4 py-8 flex justify-center"
      >
        <div className="w-full max-w-lg">
          {!doctor ? (
            <p className="text-gray-400 text-center mt-20">
              {rtl ? "تعذر العثور على معلومات هذا الطبيب." : "Doctor information not found."}
            </p>
          ) : (
            <article className="flex flex-col gap-5">
              <div className="flex items-center gap-4">
                {doctor.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={doctor.imageUrl}
                    alt={doctor.name}
                    className="h-28 w-28 rounded-md object-cover border border-gray-800 flex-shrink-0"
                  />
                ) : null}
                <div className="flex flex-col gap-1 min-w-0">
                  <h1 className="text-xl font-semibold text-white">{doctor.name}</h1>
                  {doctor.specialty && <span className="text-sm text-gray-300">{doctor.specialty}</span>}
                  {doctor.hospital && <span className="text-xs text-gray-500">{doctor.hospital}</span>}
                </div>
              </div>
              {doctor.bioLines.length > 0 && (
                <ul className="flex flex-col gap-2 border-t border-gray-800 pt-4 text-sm leading-relaxed">
                  {doctor.bioLines.map((line, i) => (
                    <li key={i} className={line.endsWith(":") ? "font-semibold text-white mt-2" : "text-gray-300"}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          )}
        </div>
      </main>
    </>
  );
}
