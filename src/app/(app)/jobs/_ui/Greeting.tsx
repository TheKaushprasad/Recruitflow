"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
function part() {
  const h = new Date().getHours(); // the recruiter's own clock, not the server's
  return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function Greeting({ firstName }: { firstName: string | null }) {
  const hello = useSyncExternalStore(noop, part, () => "Hello");
  return <h1 className="page-title">{hello}{firstName ? `, ${firstName}` : ""}</h1>;
}
