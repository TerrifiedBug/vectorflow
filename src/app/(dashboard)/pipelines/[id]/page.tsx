import { redirect } from "next/navigation";

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const qs = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((v) => qs.append(key, v));
    } else if (value != null) {
      qs.set(key, value);
    }
  }

  const suffix = qs.toString();
  redirect(`/pipelines/${id}/edit${suffix ? `?${suffix}` : ""}`);
}
