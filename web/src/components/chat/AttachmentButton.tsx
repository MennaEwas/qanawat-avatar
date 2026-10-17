"use client";

// Opens WhatsApp for the patient with instructions to attach their own
// file/photo, the same click-to-chat pattern used by the booking/reception
// hand-off cards -- this is the ONLY reliable mechanism for the hospital's
// hotline number specifically: it's a landline/call-center-style number
// (confirmed via a direct send test, error "(#100) Invalid parameter" for
// any message -- text or media -- while a real Kuwait mobile number worked
// instantly with the identical request), so our server cannot push a
// message or media to it via the WhatsApp Cloud API. wa.me deep links
// don't go through that API at all -- they just open the *patient's own*
// WhatsApp app pointed at the number -- so they aren't affected by this.
const HOSPITAL_WHATSAPP_HOTLINE = "9651830003";
const HOSPITAL_WHATSAPP_HOTLINE_DISPLAY = "+965 1830 003";

export const AttachmentButton = ({ accentColor }: { accentColor: string }) => {
  const message =
    "Hello, I'd like to send a photo/document related to my visit (e.g. insurance card, referral letter).";
  const link = `https://wa.me/${HOSPITAL_WHATSAPP_HOTLINE}?text=${encodeURIComponent(message)}`;

  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open WhatsApp (${HOSPITAL_WHATSAPP_HOTLINE_DISPLAY}) to send a file`}
      className={`p-2 rounded-md text-gray-400 hover:text-${accentColor}-500 hover:bg-${accentColor}-950 flex items-center justify-center`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 01-7.78-7.78l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.48"
        />
      </svg>
    </a>
  );
};
