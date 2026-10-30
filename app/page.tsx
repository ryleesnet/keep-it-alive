import { Suspense } from "react";
import { KeepAliveApp } from "@/components/KeepAliveApp";

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="boot">
          <div className="orb-icon" />
          <p>KEEP IT ALIVE</p>
        </div>
      }
    >
      <KeepAliveApp />
    </Suspense>
  );
}
