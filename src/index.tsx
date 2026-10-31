import { useId, type CSSProperties } from 'react';

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type DeliveryStatus = 'pending' | 'success' | 'failed';

export interface WebhookDelivery {
  id: string;
  event: string;
  endpoint: string;
  timestamp: number;
  attempt: number;
  payload: JsonValue;
  statusCode?: number;
  duration?: number;
  responseBody?: JsonValue;
  error?: string;
}

export interface DeliveryFilter {
  query?: string;
  status?: DeliveryStatus | 'all';
}

export function getDeliveryStatus(delivery: WebhookDelivery): DeliveryStatus {
  if (delivery.error) return 'failed';
  if (delivery.statusCode === undefined) return 'pending';
  return delivery.statusCode >= 200 && delivery.statusCode < 300 ? 'success' : 'failed';
}

export function filterDeliveries(
  deliveries: readonly WebhookDelivery[],
  { query = '', status = 'all' }: DeliveryFilter = {},
): WebhookDelivery[] {
  const needle = query.trim().toLowerCase();
  return deliveries.filter(
    (delivery) =>
      (status === 'all' || getDeliveryStatus(delivery) === status) &&
      `${delivery.id} ${delivery.event} ${delivery.endpoint}`.toLowerCase().includes(needle),
  );
}

export interface PayloadChange {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: JsonValue;
  after?: JsonValue;
}

export interface ComparisonOptions {
  maxDepth?: number;
  maxChanges?: number;
  maxNodes?: number;
}

export interface PayloadComparison {
  changes: PayloadChange[];
  truncated: boolean;
}

const boundedLimit = (value: number | undefined, fallback: number, ceiling: number): number =>
  value !== undefined && Number.isFinite(value)
    ? Math.max(0, Math.min(ceiling, Math.floor(value)))
    : fallback;

export function comparePayloads(
  before: JsonValue,
  after: JsonValue,
  options: ComparisonOptions = {},
): PayloadComparison {
  const maxDepth = boundedLimit(options.maxDepth, 32, 64);
  const maxChanges = boundedLimit(options.maxChanges, 500, 10000);
  const maxNodes = boundedLimit(options.maxNodes, 10000, 100000);
  const result: PayloadComparison = { changes: [], truncated: false };
  let visited = 0;
  const walk = (left: JsonValue, right: JsonValue, path: string, depth: number) => {
    if (++visited > maxNodes) {
      result.truncated = true;
      return;
    }
    if (Object.is(left, right)) return;
    if (result.changes.length >= maxChanges || depth > maxDepth) {
      result.truncated = true;
      return;
    }
    if (
      left !== null &&
      right !== null &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      Array.isArray(left) === Array.isArray(right)
    ) {
      const a = left as Readonly<Record<string, JsonValue>>;
      const b = right as Readonly<Record<string, JsonValue>>;
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) {
        if (result.changes.length >= maxChanges || visited >= maxNodes) {
          result.truncated = true;
          break;
        }
        const childPath = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        if (!Object.hasOwn(a, key)) {
          visited++;
          result.changes.push({ path: childPath, kind: 'added', after: b[key] as JsonValue });
        } else if (!Object.hasOwn(b, key)) {
          visited++;
          result.changes.push({ path: childPath, kind: 'removed', before: a[key] as JsonValue });
        } else {
          walk(a[key] as JsonValue, b[key] as JsonValue, childPath, depth + 1);
        }
      }
    } else {
      result.changes.push({ path, kind: 'changed', before: left, after: right });
    }
  };
  walk(before, after, '', 0);
  return result;
}

export function formatWebhookPayload(payload: JsonValue | undefined, maxLength = 10000): string {
  const limit = boundedLimit(maxLength, 10000, 1000000);
  let text: string;
  try {
    text = JSON.stringify(payload, null, 2) ?? '(empty)';
  } catch {
    text = '[Unserializable payload]';
  }
  return text.length > limit ? `${text.slice(0, limit)}\n[Truncated]` : text;
}

export interface WebhookViewerProps {
  deliveries: readonly WebhookDelivery[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  compareId?: string | null;
  onCompareChange?: (id: string | null) => void;
  filter?: DeliveryFilter;
  onFilterChange?: (filter: DeliveryFilter) => void;
  maxPayloadLength?: number;
  comparisonOptions?: ComparisonOptions;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export function WebhookViewer({
  deliveries,
  selectedId = null,
  onSelect,
  compareId = null,
  onCompareChange,
  filter = {},
  onFilterChange,
  maxPayloadLength = 10000,
  comparisonOptions,
  className = '',
  style,
  ariaLabel = 'Webhook viewer',
}: WebhookViewerProps) {
  const id = useId();
  const visible = filterDeliveries(deliveries, filter);
  const selected = deliveries.find((delivery) => delivery.id === selectedId);
  const compared = deliveries.find((delivery) => delivery.id === compareId);
  const comparison =
    selected && compared
      ? comparePayloads(compared.payload, selected.payload, comparisonOptions)
      : null;
  return (
    <section className={`lp-webhook ${className}`} style={style} aria-label={ariaLabel}>
      <div className="lp-webhook-filters">
        <label htmlFor={`${id}-query`}>Filter deliveries</label>
        <input
          id={`${id}-query`}
          value={filter.query ?? ''}
          readOnly={!onFilterChange}
          onChange={(event) => onFilterChange?.({ ...filter, query: event.target.value })}
        />
        <label htmlFor={`${id}-status`}>Delivery status</label>
        <select
          id={`${id}-status`}
          value={filter.status ?? 'all'}
          disabled={!onFilterChange}
          onChange={(event) =>
            onFilterChange?.({
              ...filter,
              status: event.target.value as DeliveryStatus | 'all',
            })
          }
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <p role="status">{visible.length} deliveries</p>
      <div className="lp-webhook-scroll">
        <table>
          <caption>Supplied webhook delivery events</caption>
          <thead>
            <tr>
              <th>Event</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th>Attempt</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((delivery) => (
              <tr key={delivery.id} data-selected={delivery.id === selectedId}>
                <td>
                  <button
                    type="button"
                    disabled={!onSelect}
                    aria-pressed={delivery.id === selectedId}
                    onClick={() => onSelect?.(delivery.id)}
                  >
                    {delivery.event} ({delivery.id})
                  </button>
                </td>
                <td>{delivery.endpoint}</td>
                <td>
                  {getDeliveryStatus(delivery)} {delivery.statusCode ?? ''}
                </td>
                <td>{delivery.attempt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p>No matching deliveries.</p>}
      {selected ? (
        <article aria-label="Delivery details">
          <h3>
            {selected.event} ({selected.id})
          </h3>
          <p>Endpoint: {selected.endpoint}</p>
          <p>
            Timestamp: {selected.timestamp} | Duration: {selected.duration ?? 'unknown'} ms
          </p>
          {selected.error && <p role="alert">{selected.error}</p>}
          <h4>Payload</h4>
          <pre>{formatWebhookPayload(selected.payload, maxPayloadLength)}</pre>
          <h4>Response</h4>
          <pre>{formatWebhookPayload(selected.responseBody, maxPayloadLength)}</pre>
          <label htmlFor={`${id}-compare`}>Compare baseline</label>
          <select
            id={`${id}-compare`}
            value={compareId ?? ''}
            disabled={!onCompareChange}
            onChange={(event) => onCompareChange?.(event.target.value || null)}
          >
            <option value="">None</option>
            {deliveries.map((delivery) => (
              <option key={delivery.id} value={delivery.id}>
                {delivery.event} ({delivery.id})
              </option>
            ))}
          </select>
          {comparison && (
            <section aria-label="Payload comparison">
              <h4>
                Baseline {compared?.id} to selected {selected.id}
              </h4>
              {!comparison.changes.length && !comparison.truncated && <p>Payloads are equal.</p>}
              {comparison.truncated && (
                <p role="status">Comparison limit reached; results are incomplete.</p>
              )}
              <ol>
                {comparison.changes.map((change) => (
                  <li key={change.path}>
                    <strong>
                      {change.kind}: {change.path || '(root)'}
                    </strong>
                    <pre>Before: {formatWebhookPayload(change.before, maxPayloadLength)}</pre>
                    <pre>After: {formatWebhookPayload(change.after, maxPayloadLength)}</pre>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </article>
      ) : (
        <p>Select a delivery for details.</p>
      )}
    </section>
  );
}
