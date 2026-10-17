// getServerSideProps helper for the screen pages ("/" and /s/[id]).
// Server-only: imported from getServerSideProps, which Next strips from the
// client bundle together with this module.
import { ScreenConfig, isValidScreenId } from "./screen";
import { getScreen } from "./screenStore";

export async function loadScreenProps(
  id: string,
): Promise<{ props: { screen: ScreenConfig } } | { notFound: true }> {
  if (!isValidScreenId(id)) return { notFound: true };
  return { props: { screen: await getScreen(id) } };
}
