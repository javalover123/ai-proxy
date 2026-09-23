import { CopyButton } from "@/components/core/CopyButton";

export default function RawView({ content }: { content: string }) {
  return (
    <div className="flex flex-col h-full">
      <div className="relative min-h-0 flex-1 group/mini">
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 transition-all opacity-0 group-hover/mini:opacity-100">
          <CopyButton
            text={content}
            size="sm"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated/30 transition-colors"
          />
        </div>
        <div className="absolute inset-0 overflow-auto">
          {content ? (
            <pre className="whitespace-pre-wrap break-all px-3 py-2 text-prose-md text-foreground/80 font-mono">
              {content}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
