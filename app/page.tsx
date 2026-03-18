import { Analytics } from "@vercel/analytics/react";
import dynamic from "next/dynamic";
import { getServerSideConfig } from "./config/server";

const serverConfig = getServerSideConfig();
const Home = dynamic(() => import("./components/home"), {
  ssr: false,
  loading: () => <div suppressHydrationWarning />,
});

export default async function App() {
  return (
    <>
      <Home />
      {serverConfig?.isVercel && (
        <>
          <Analytics />
        </>
      )}
    </>
  );
}
