# @lp-labs/react-webhook-viewer

A controlled React viewer for supplied webhook delivery events: search/status
filtering, delivery detail and bounded structural JSON payload comparison.
It does not receive, send, retry or verify webhooks. React 18 or 19 is the only
peer dependency and there are no runtime dependencies.

## Installation

```sh
npm install @lp-labs/react-webhook-viewer react
```

```tsx
import { useState } from "react";
import {
  WebhookViewer, type WebhookDelivery, type DeliveryFilter,
} from "@lp-labs/react-webhook-viewer";
import "@lp-labs/react-webhook-viewer/styles.css";

const deliveries: WebhookDelivery[] = [
  {
    id: "attempt-1", event: "order.created", endpoint: "https://example.com/hook",
    timestamp: 1700000000000, attempt: 1, statusCode: 500, duration: 180,
    payload: { orderId: 42, state: "new" }, error: "Receiver returned 500",
  },
  {
    id: "attempt-2", event: "order.created", endpoint: "https://example.com/hook",
    timestamp: 1700000001000, attempt: 2, statusCode: 200, duration: 90,
    payload: { orderId: 42, state: "confirmed" }, responseBody: { accepted: true },
  },
];

export function Deliveries() {
  const [selectedId, onSelect] = useState<string | null>("attempt-2");
  const [compareId, onCompareChange] = useState<string | null>("attempt-1");
  const [filter, onFilterChange] = useState<DeliveryFilter>({});
  return (
    <WebhookViewer
      deliveries={deliveries}
      selectedId={selectedId}
      onSelect={onSelect}
      compareId={compareId}
      onCompareChange={onCompareChange}
      filter={filter}
      onFilterChange={onFilterChange}
    />
  );
}
```

ESM and CommonJS have identical named exports:
`const { WebhookViewer } = require("@lp-labs/react-webhook-viewer")`.
There is no default export. Load CSS through your application's CSS-aware bundler.
Module imports never read the DOM or install network listeners.

## WebhookViewer props

The exported `WebhookViewerProps` interface covers all props below. Selection,
comparison and filters are controlled; callbacks request parent state changes.

| Prop | Type | Default / behavior |
| --- | --- | --- |
| `deliveries` | `readonly WebhookDelivery[]` | Required; caller order, unique stable IDs |
| `selectedId` | `string \| null` | `null`; missing IDs show selection prompt |
| `onSelect` | `(id: string) => void` | Absent; selection buttons disabled |
| `compareId` | `string \| null` | `null`; baseline delivery, independent of filters |
| `onCompareChange` | `(id: string \| null) => void` | Absent; baseline selector disabled |
| `filter` | `DeliveryFilter` | `{}`; all records |
| `onFilterChange` | `(filter: DeliveryFilter) => void` | Absent; query read-only, status disabled |
| `maxPayloadLength` | `number` | `10000`; per displayed payload/change side |
| `comparisonOptions` | `ComparisonOptions` | Helper defaults below |
| `className` | `string` | `""`; appended to `lp-webhook` |
| `style` | `CSSProperties` | Absent; outer section |
| `ariaLabel` | `string` | `"Webhook viewer"` |

Comparison direction is **baseline (`compareId`) before -> selected (`selectedId`)
after**. A hidden-by-filter record can remain selected or be a baseline. Missing
baseline IDs omit comparison; comparing a delivery with itself reports equality.
Filters do not mutate/reset selection. No matching records show a text empty state.
Delivery errors are alerts, not thrown exceptions. Callback errors are not caught;
use your application's error boundary. There are no package-specific error classes.

## Types

- `JsonValue`: recursive union of `null | boolean | number | string`,
  `readonly JsonValue[]`, and `{ readonly [key: string]: JsonValue }`. Use plain,
  finite, acyclic JSON-compatible data, not dates, undefined properties, functions,
  proxies, sparse arrays or getters.
- `DeliveryStatus`: `"pending" | "success" | "failed"`.
- `WebhookDelivery`: required strings `id`, `event`, `endpoint`; numbers
  `timestamp`, `attempt`; and `payload: JsonValue`. Optional `statusCode: number`,
  `duration: number` (ms), `responseBody: JsonValue`, `error: string`.
  Timestamp is displayed numerically in the supplied time base (normally epoch ms);
  attempt is a supplied count, not inferred.
- `DeliveryFilter`: optional `query: string`, `status: DeliveryStatus | "all"`.
- `PayloadChange`: `path: string`, `kind: "added" | "removed" | "changed"`,
  optional `before: JsonValue`, `after: JsonValue`. Missing sides are absent,
  distinguishable from JSON `null`.
- `ComparisonOptions`: optional numbers `maxDepth`, `maxChanges`, `maxNodes`.
- `PayloadComparison`: `{ changes: PayloadChange[]; truncated: boolean }`.
- `WebhookViewerProps`: complete component props above.

## Pure helpers

All helpers leave supplied data unmodified.

### getDeliveryStatus(delivery: WebhookDelivery): DeliveryStatus

A nonempty `error` means `"failed"`, even with a 2xx status. An omitted statusCode
means `"pending"`; codes 200..299 are `"success"` and all other codes `"failed"`.
This is a display convention, not a transport or signature verifier.

### filterDeliveries(deliveries, filter = {}): WebhookDelivery[]

Accepts `readonly WebhookDelivery[]` and `DeliveryFilter`. Returns original records
in a new array, preserving caller order. Query defaults to `""` and uses trimmed,
case-insensitive substring matching across ID, event and endpoint.
Status defaults to `"all"`; otherwise it matches `getDeliveryStatus`.
An empty array returns `[]`.

### comparePayloads(before, after, options = {}): PayloadComparison

Accepts two `JsonValue` inputs. Returns deterministic, key-sorted structural changes
without mutating input. Object key order is ignored. Arrays compare by index, not
element identity; array/object and primitive/container transitions are atomic
`"changed"` records. Added/removed subtrees are atomic records.

Paths are JSON Pointers: root is `""`, `/` in keys becomes `~1`, `~` becomes `~0`.
`/items/0/name` refers to an array element's property. Root changes use the empty path.
Equal inputs return `{ changes: [], truncated: false }`.

| Option | Default | Finite allowed range |
| --- | --- | --- |
| `maxDepth` | `32` | 0..64; root is depth 0 |
| `maxChanges` | `500` | 0..10000 |
| `maxNodes` | `10000` | 0..100000 traversal visits |

Finite options are floored/clamped; nonfinite values use defaults. Limits stop
further descent/work and set `truncated: true`; partial/empty results with that
flag MUST NOT be interpreted as equality. Atomic added/removed subtrees are not
recursively traversed. Traversal can still enumerate keys on a wide object before
its visit budget is exhausted. Separate identical subtrees can consume visits;
reference-identical subtrees short-circuit. Unsupported cyclic input is not a JSON
contract; recursion depth limits prevent unbounded descent but are not cycle analysis.
Throwing getters/proxies are not caught by comparison.

### formatWebhookPayload(payload, maxLength = 10000): string

Accepts `JsonValue | undefined`, returns indented JSON; `undefined` returns
`"(empty)"`. Serialization failures (including circular objects supplied outside
the type contract) return `"[Unserializable payload]"`. Finite limits are
floored/clamped to 0..1000000; nonfinite limits use 10000.
Overflow appends `"\n[Truncated]"` after the retained characters.
The marker is outside the character limit.

```ts
import {
  getDeliveryStatus, filterDeliveries, comparePayloads, formatWebhookPayload,
  type JsonValue, type PayloadChange, type PayloadComparison,
} from "@lp-labs/react-webhook-viewer";

const before: JsonValue = { state: "new", items: [1] };
const after: JsonValue = { state: "paid", items: [1, 2] };
const result: PayloadComparison = comparePayloads(before, after, { maxChanges: 20 });
const changes: PayloadChange[] = result.changes;
console.log(changes, result.truncated, formatWebhookPayload(after, 500));
const failed = filterDeliveries(deliveries, { status: "failed" });
console.log(failed.map(getDeliveryStatus));
```

## Customization and accessibility

Override `--lp-webhook-accent` and `--lp-webhook-border` on `.lp-webhook`.
Pass `className` or `style` to customize the outer section. Labels, native selects,
captioned table, pressed selection buttons, live result count and alert errors
support keyboard/screen-reader use. Comparison includes textual change kinds and
both values, not color-only signals. Focus outlines are visible. Payloads and URLs
are escaped text, never injected HTML; endpoints are not clickable.

## Performance and real limits

There is no backend, listener, request sender, retry engine, scheduling, persistence,
signature verification, automatic event capture or secret redaction. Sanitize
payloads, endpoint URLs, response bodies and errors before supplying them.
Never use this UI as evidence that a delivery was authenticated.

Filtering is linear and all matching rows render without virtualization. Bound
record count in the parent. Comparison is bounded by the options but creating key
lists and formatting atomic changes can still cost memory on large data.
Formatting serializes the whole value before truncation, so the character limit
does not bound serialization work. Supply bounded plain JSON data. Binary bodies,
streaming, semantic array matching and line-by-line text diffs are not supported.

## License

[MIT](./LICENSE).

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
