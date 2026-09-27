import { PageSkeleton } from "@/components/PageSkeleton";

// Shown inside the job layout (header and tabs stay visible) while a tab loads.
export default function Loading() {
  return <PageSkeleton rows={5} />;
}
