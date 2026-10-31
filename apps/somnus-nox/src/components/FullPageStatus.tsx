export function FullPageStatus({ message }: { message: string }) {
  return (
    <main id="main" tabIndex={-1} className="flex min-h-dvh items-center justify-center p-6">
      <div role="status" aria-live="polite">
        <h1 className="text-base font-normal text-somnus-subtle">{message}</h1>
      </div>
    </main>
  );
}
