import type { ApiClientError } from '@/lib/api/types';

type ErrorMessageProps = {
  error: ApiClientError | string;
  title?: string;
};

export function ErrorMessage({ error, title = 'Something went wrong' }: ErrorMessageProps) {
  const message = typeof error === 'string' ? error : error.message;
  const code = typeof error === 'string' ? undefined : error.code;

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4" role="alert">
      <p className="text-sm font-bold text-red-900">{title}</p>
      <p className="mt-1 text-sm text-red-700">{message}</p>
      {code ? (
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-red-500">{code}</p>
      ) : null}
    </div>
  );
}
