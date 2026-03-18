"use client";

import dynamic from "next/dynamic";

const Home = dynamic(() => import("./home"), {
  ssr: false,
  loading: () => <div suppressHydrationWarning />,
});

export default function HomeEntry() {
  return <Home />;
}
