/**
 * A full-page status region (loading / verifying). role="status" +
 * aria-live="polite" so screen readers announce it without stealing
 * focus (build plan §20 9.1 a11y baseline).
 */
export function FullPageStatus({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <p role="status" aria-live="polite" className="text-somnus-subtle">
        {message}
      </p>
    </div>
  );
}
