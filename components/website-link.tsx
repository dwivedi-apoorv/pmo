export function WebsiteLink({ url }: { url: string | null }) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline-offset-4 hover:underline"
    >
      {url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
    </a>
  );
}
