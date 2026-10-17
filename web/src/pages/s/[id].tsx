import type { GetServerSideProps } from "next";

import { loadScreenProps } from "@/lib/loadScreen";
import Home from "../index";

// /s/<id> -- the same avatar page as "/", configured by screen <id> in /admin.
export const getServerSideProps: GetServerSideProps = async ({ params }) =>
  loadScreenProps(String(params?.id || "").toLowerCase());

export default Home;
