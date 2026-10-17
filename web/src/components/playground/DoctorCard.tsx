"use client";

interface DoctorCardData {
  name?: string;
  specialty?: string;
  image_url?: string;
  hospital_address?: string;
  bio?: string;
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
        <div className="flex flex-col min-w-0">
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
      </div>
      {data.bio && (
        <p className="text-gray-400 text-xs mt-2 pt-2 border-t border-gray-800 whitespace-pre-line max-h-32 overflow-y-auto">
          {data.bio}
        </p>
      )}
    </div>
  );
}
