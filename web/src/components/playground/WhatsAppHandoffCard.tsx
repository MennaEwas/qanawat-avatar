"use client";

import { QRCodeSVG } from "qrcode.react";

interface WhatsAppHandoffData {
  link?: string;
  hotline_display?: string;
  title?: string;
  subtitle?: string;
}

export function WhatsAppHandoffCard({
  rawAttribute,
  themeColor,
}: {
  rawAttribute: string | undefined;
  themeColor: string;
}) {
  if (!rawAttribute) {
    return null;
  }

  let data: WhatsAppHandoffData;
  try {
    data = JSON.parse(rawAttribute);
  } catch {
    return null;
  }

  if (!data.link) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 w-full rounded-sm border border-gray-800 bg-gray-950 p-3">
      {/* Sized up and given a real quiet-zone margin so it scans reliably
          from a phone at arm's length, not just up close. */}
      <div className="bg-white p-2.5 rounded-sm flex-shrink-0">
        <QRCodeSVG value={data.link} width={112} height={112} />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-gray-200 font-medium">
          {data.title || "Continue on WhatsApp"}
        </span>
        {data.subtitle && (
          <span className={`text-${themeColor}-500 text-xs truncate`}>
            {data.subtitle}
          </span>
        )}
        <a
          href={data.link}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-${themeColor}-400 text-xs underline mt-1`}
        >
          Tap to open WhatsApp
        </a>
        {data.hotline_display && (
          <span className="text-gray-500 text-xs mt-1">
            Hotline: {data.hotline_display}
          </span>
        )}
      </div>
    </div>
  );
}
