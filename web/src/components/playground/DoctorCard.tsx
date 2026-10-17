"use client";

import { QRCodeSVG } from "qrcode.react";

interface DoctorCardData {
  name?: string;
  specialty?: string;
  image_url?: string;
  hospital_address?: string;
  bio?: string;
  // Set by the agent once it has looked the doctor up via search_bio_all:
  // the QR opens /doctor, which re-fetches that bio + photo by these.
  doctor_id?: string;
  bio_term?: string;
  bio_lang?: string;
}

function doctorInfoUrl(data: DoctorCardData): string | null {
  if (!data.doctor_id || !data.bio_term || typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams({
    id: data.doctor_id,
    term: data.bio_term,
    lang: data.bio_lang === "E" ? "E" : "A",
  });
  return `${window.location.origin}/doctor?${params.toString()}`;
}

export function DoctorCard({
  rawAttribute,
  themeColor,
}: {
  rawAttribute: string | undefined;
  themeColor: string;
}) {
  if (!rawAttribute) {
    return null;
  }

  let data: DoctorCardData;
  try {
    data = JSON.parse(rawAttribute);
  } catch {
    return null;
  }

  if (!data.name) {
    return null;
  }

  const infoUrl = doctorInfoUrl(data);

  return (
    <div className="flex flex-col w-full rounded-sm border border-gray-800 bg-gray-950 p-3">
      <div className="flex items-center gap-3">
        {data.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.image_url}
            alt={data.name}
            className="h-16 w-16 rounded-sm object-cover flex-shrink-0 border border-gray-800"
          />
        ) : (
          <div
            className={`h-16 w-16 rounded-sm flex-shrink-0 border border-gray-800 flex items-center justify-center text-${themeColor}-500 text-xl font-semibold bg-gray-900`}
          >
            {data.name.trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-gray-200 font-medium truncate">{data.name}</span>
          {data.specialty && (
            <span className={`text-${themeColor}-500 text-sm truncate`}>
              {data.specialty}
            </span>
          )}
          {data.hospital_address && (
            <span className="text-gray-500 text-xs mt-1">
              {data.hospital_address}
            </span>
          )}
        </div>
        {infoUrl && (
          <a
            href={infoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 rounded-sm p-1"
            // Literal white, not bg-white (the theme maps "white" to dark
            // text color): QR codes need a light quiet zone to scan.
            style={{ background: "#fff" }}
            title="More about this doctor"
          >
            <QRCodeSVG value={infoUrl} width={72} height={72} />
          </a>
        )}
      </div>
      {data.bio && (
        <p dir="auto" className="text-gray-400 text-xs mt-2 pt-2 border-t border-gray-800 whitespace-pre-line max-h-32 overflow-y-auto">
          {data.bio}
        </p>
      )}
    </div>
  );
}
