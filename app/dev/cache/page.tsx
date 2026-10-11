import { notFound } from "next/navigation";
import CacheViewer from "./CacheViewer";

export const metadata = { title: "Response cache (dev)" };

export default function CachePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CacheViewer />;
}
