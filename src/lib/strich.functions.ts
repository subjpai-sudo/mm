import { createServerFn } from "@tanstack/react-start";

export const getStrichLicense = createServerFn({ method: "GET" }).handler(async () => {
  return { key: process.env.STRICH_LICENSE_KEY ?? "" };
});