import { useEffect, useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Page } from '../api/contracts.ts';
import { ApiError } from '../api/errors.ts';

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong.';
}

/**
 * An error with a retry button. While the request runs again, the error gives way to
 * `busyText` (if any) and the same button, still focused, says it is trying again.
 */
function ErrorWithRetry({
  message,
  fetching,
  busyText,
  onRetry,
}: {
  message: string;
  fetching: boolean;
  busyText?: string;
  onRetry: () => void;
}) {
  return (
    <div className="records-message records-error">
      {fetching ? (
        busyText && (
          <p key="busy" role="status">
            {busyText}
          </p>
        )
      ) : (
        <p key="error" role="alert">
          {message}
        </p>
      )}
      <button
        type="button"
        className="records-button"
        aria-disabled={fetching}
        onClick={() => {
          if (!fetching) onRetry();
        }}
      >
        {fetching ? 'Trying again…' : 'Try again'}
      </button>
    </div>
  );
}

/** Previous / Next around the page status; buttons only when there is somewhere to go. */
function Pager({
  what,
  page,
  status,
  canGoBack,
  canGoForward,
  onPage,
}: {
  what: string;
  page: number;
  status: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onPage: (page: number) => void;
}) {
  const showButtons = canGoBack || canGoForward;
  return (
    <div className="records-pager">
      {showButtons && (
        <button
          type="button"
          className="records-button"
          aria-label={`Previous ${what} page`}
          disabled={!canGoBack}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
      )}
      <p className="records-status" role="status">
        {status}
      </p>
      {showButtons && (
        <button
          type="button"
          className="records-button"
          aria-label={`Next ${what} page`}
          disabled={!canGoForward}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      )}
    </div>
  );
}

/**
 * One paginated list from the API, with every state: first load, error with retry, empty,
 * the list itself, a placeholder while another page loads, and background refreshes.
 */
export function RecordsView<Item>({
  query,
  page,
  onPage,
  what,
  empty,
  children,
}: {
  query: UseQueryResult<Page<Item>>;
  page: number;
  onPage: (page: number) => void;
  /** What the list is, for messages: "ranking", "match history". */
  what: string;
  empty: string;
  /** Renders the rows; `shownPage` is the page they belong to (not always `page`). */
  children: (items: Item[], shownPage: number) => ReactNode;
}) {
  const { data, isPending, isError, isFetching, isPlaceholderData, error, refetch } = query;
  const lastPage = data && !isPlaceholderData ? Math.max(1, data.totalPages) : null;

  /**
   * Number of pages according to the last valid response, kept while a page fails to load
   * so the player can still move to pages known to exist (null: nothing known yet).
   */
  const [knownPages, setKnownPages] = useState<number | null>(null);
  if (data && data.totalPages !== knownPages) setKnownPages(data.totalPages);

  /**
   * A retry asked for with Try again, until its answer (data or error) arrives. Needed
   * because a query without data goes back to "pending" while it runs again.
   */
  const [retryMark, setRetryMark] = useState<{
    page: number;
    errors: number;
    dataAt: number;
  } | null>(null);
  const retrying =
    retryMark !== null &&
    retryMark.page === page &&
    retryMark.errors === query.errorUpdateCount &&
    retryMark.dataAt === query.dataUpdatedAt;
  const retry = () => {
    setRetryMark({ page, errors: query.errorUpdateCount, dataAt: query.dataUpdatedAt });
    void refetch();
  };

  // The list may have shrunk (e.g. mock data reset): go back to its last page.
  useEffect(() => {
    if (lastPage !== null && page > lastPage) onPage(lastPage);
  }, [lastPage, page, onPage]);

  if (isPending && !retrying) {
    return (
      <p className="records-message" role="status">
        Loading the {what}…
      </p>
    );
  }

  // Without data, the selected page failed (or is being tried again). The pager stays,
  // limited to pages known to exist: page 1 always, further pages only from a valid response.
  const pages = data ? Math.max(1, data.totalPages) : knownPages;
  const canGoBack = page > 1;
  const canGoForward = pages !== null && page < pages;
  const status = !data
    ? knownPages !== null
      ? `Page ${page} of ${knownPages}`
      : `Page ${page}`
    : isPlaceholderData
      ? `Loading page ${page}…`
      : isFetching
        ? 'Updating…'
        : data.totalItems === 0
          ? ''
          : `Page ${data.page} of ${pages}`;
  const showPager = data !== undefined || canGoBack || canGoForward;

  // Keys keep each part (and the focused Try again button) in place as the state changes.
  return (
    <div className="records">
      {data &&
        (data.totalItems === 0 ? (
          <p key="empty" className="records-message">
            {empty}
          </p>
        ) : (
          <div key="rows" className="records-scroll" aria-busy={isPlaceholderData}>
            {children(data.items, data.page)}
          </div>
        ))}
      {(!data || isError || retrying) && (
        <ErrorWithRetry
          key="retry"
          message={
            data
              ? `Could not refresh the ${what}; showing the last results. ${errorMessage(error)}`
              : `Could not load the ${what}. ${errorMessage(error)}`
          }
          fetching={isFetching || retrying}
          busyText={data ? undefined : `Loading the ${what}…`}
          onRetry={retry}
        />
      )}
      {showPager && (
        <Pager
          key="pager"
          what={what}
          page={page}
          status={status}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onPage={onPage}
        />
      )}
    </div>
  );
}
