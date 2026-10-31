import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import * as api from '../dist/esm/index.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

const deliveries = [
  {
    id: 'one',
    event: 'order.created',
    endpoint: 'https://example.test/hook',
    timestamp: 10,
    attempt: 1,
    statusCode: 200,
    duration: 12,
    payload: { count: 1, html: '<script>plain</script>' },
    responseBody: { accepted: true },
  },
  {
    id: 'two',
    event: 'order.created',
    endpoint: 'https://example.test/hook',
    timestamp: 20,
    attempt: 2,
    statusCode: 500,
    error: 'Receiver failed',
    payload: { count: 2, html: '<script>plain</script>' },
  },
  {
    id: 'three',
    event: 'user.created',
    endpoint: '/pending',
    timestamp: 30,
    attempt: 1,
    payload: null,
  },
];

test('delivery status and filtering distinguish pending, failure and success', () => {
  assert.deepEqual(deliveries.map(api.getDeliveryStatus), ['success', 'failed', 'pending']);
  assert.equal(api.getDeliveryStatus({ ...deliveries[0], error: 'transport' }), 'failed');
  assert.deepEqual(api.filterDeliveries(deliveries, { query: 'ORDER', status: 'failed' }), [
    deliveries[1],
  ]);
  assert.equal(api.filterDeliveries(deliveries).length, 3);
});

test('payload comparison is structural, deterministic and uses JSON pointer paths', () => {
  const before = { 'a/b': { '~key': 1 }, list: [1, 2], gone: null };
  const after = { 'a/b': { '~key': 2 }, list: [1, 3, 4], new: true };
  assert.deepEqual(api.comparePayloads(before, after), {
    changes: [
      { path: '/a~1b/~0key', kind: 'changed', before: 1, after: 2 },
      { path: '/gone', kind: 'removed', before: null },
      { path: '/list/1', kind: 'changed', before: 2, after: 3 },
      { path: '/list/2', kind: 'added', after: 4 },
      { path: '/new', kind: 'added', after: true },
    ],
    truncated: false,
  });
  assert.deepEqual(api.comparePayloads({ a: 1, b: 2 }, { b: 2, a: 1 }).changes, []);
  assert.equal(api.comparePayloads(null, {}).changes[0].path, '');
  assert.equal(api.comparePayloads([], {}).changes[0].kind, 'changed');
  assert.equal(before['a/b']['~key'], 1);
});

test('comparison limits cap changes, depth and traversal; formatting contains failures', () => {
  assert.equal(
    api.comparePayloads({ a: 1, b: 2 }, { a: 2, b: 3 }, { maxChanges: 1 }).truncated,
    true,
  );
  assert.equal(
    api.comparePayloads({ a: { b: 1 } }, { a: { b: 2 } }, { maxDepth: 0 }).truncated,
    true,
  );
  assert.equal(api.comparePayloads({ a: 1 }, { a: 1 }, { maxNodes: 1 }).truncated, true);
  const cycle = {};
  cycle.self = cycle;
  assert.equal(api.formatWebhookPayload(cycle), '[Unserializable payload]');
  assert.equal(api.formatWebhookPayload('abcdef', 3), '"ab\n[Truncated]');
  assert.equal(api.formatWebhookPayload(undefined), '(empty)');
  assert.equal(api.comparePayloads(cycle, { self: {} }).truncated, false);
});

test('controlled selection, filter, baseline comparison and errors', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function App() {
    const [selectedId, onSelect] = useState(null);
    const [compareId, onCompareChange] = useState(null);
    const [filter, onFilterChange] = useState({});
    return React.createElement(api.WebhookViewer, {
      deliveries,
      selectedId,
      onSelect,
      compareId,
      onCompareChange,
      filter,
      onFilterChange,
    });
  }
  try {
    await act(async () => root.render(React.createElement(App)));
    await act(async () => host.querySelectorAll('tbody button')[1].click());
    assert.match(host.querySelector('[role="alert"]').textContent, /Receiver failed/);
    assert.equal(host.querySelector('script'), null);
    const baseline = host.querySelector('select[id$="-compare"]');
    await act(async () => {
      baseline.value = 'one';
      baseline.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.match(
      host.querySelector('[aria-label="Payload comparison"]').textContent,
      /changed: \/count/,
    );
    const status = host.querySelector('select[id$="-status"]');
    await act(async () => {
      status.value = 'pending';
      status.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(host.querySelectorAll('tbody tr').length, 1);
    const input = host.querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
        input,
        'missing',
      );
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    assert.match(host.textContent, /No matching deliveries/);
    await act(async () => root.render(React.createElement(api.WebhookViewer, { deliveries: [] })));
    assert.match(host.textContent, /Select a delivery/);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test('CommonJS exports match ESM', () => {
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(api).sort());
  assert.equal(cjs.getDeliveryStatus(deliveries[0]), 'success');
});
