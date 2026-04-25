export function DemoBanner() {
  return (
    <div className="bg-primary text-primary-foreground py-2 px-4 text-center text-sm">
      Public demo — data resets nightly at 03:00 UTC.{" "}
      <a
        href="https://github.com/TerrifiedBug/vectorflow"
        target="_blank"
        rel="noreferrer"
        className="underline font-medium"
      >
        Get VectorFlow on GitHub →
      </a>
    </div>
  );
}
