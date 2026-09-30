import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, submitSimulation } from '../src/services/simulationApi.js';

function mockResponses(t, values) {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, options });
        const value = values.shift();
        if (!value) throw new Error('Unexpected extra request');
        return new Response(value.body ?? JSON.stringify(value.data), { status: value.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    });
    return calls;
}
const result = { keyResults: [{ label: 'Maximum Depth', value: 2, unit: 'm' }], affectedAssets: [] };

test('submission polls running job and returns its actual frames/results', async (t) => {
    const calls = mockResponses(t, [
        { status: 202, data: { success: true, jobId: 'abc', status: 'queued' } },
        { data: { success: true, jobId: 'abc', status: 'running' } },
        { data: { success: true, jobId: 'abc', status: 'completed', results: result, simulation: { frames: [{ timeMinutes: 0 }] } } },
    ]);
    const statuses = [];
    const output = await submitSimulation({ scenarioType: 'flood' }, { pollInterval: 0, baseUrl: 'http://localhost:5000/', onStatus: value => statuses.push(value) });
    assert.deepEqual(output.results, result);
    assert.equal(output.simulation.frames.length, 1);
    assert.deepEqual(statuses, ['queued', 'running', 'completed']);
    assert.equal(calls[0].url, 'http://localhost:5000/api/simulations');
    assert.equal(JSON.parse(calls[0].options.body).scenarioType, 'flood');
    assert.equal(calls.length, 3);
});

test('validation details remain visible to the user', async (t) => {
    mockResponses(t, [{ status: 400, data: { success: false, message: 'Invalid scenario', errors: [{ path: 'advanced.manningRoughness', message: 'Must be a positive number.' }] } }]);
    await assert.rejects(requestJson('/api/simulations'), /advanced.manningRoughness: Must be a positive number/);
});

test('engine failure is surfaced without further polling', async (t) => {
    const calls = mockResponses(t, [
        { status: 202, data: { jobId: 'abc', status: 'running' } },
        { data: { success: false, jobId: 'abc', status: 'failed', error: 'External engine unavailable' } },
    ]);
    await assert.rejects(submitSimulation({}, { pollInterval: 0 }), /External engine unavailable/);
    assert.equal(calls.length, 2);
});

test('invalid API HTML response has actionable error', async (t) => {
    mockResponses(t, [{ body: '<html>Vite page</html>' }]);
    await assert.rejects(requestJson('/api/simulations'), /API URL is correct/);
});

test('missing result data does not replace completed UI results', async (t) => {
    mockResponses(t, [{ data: { jobId: 'abc', status: 'completed' } }]);
    await assert.rejects(submitSimulation({}), /without valid result data/);
});

test('unknown status fails explicitly', async (t) => {
    mockResponses(t, [{ data: { jobId: 'abc', status: 'mystery' } }]);
    await assert.rejects(submitSimulation({}), /Unexpected simulation status/);
});

test('polling is bounded', async (t) => {
    mockResponses(t, [{ data: { jobId: 'abc', status: 'running' } }]);
    await assert.rejects(submitSimulation({}, { maxPolls: 0 }), /timed out/);
});

test('abort stops polling before another request', async (t) => {
    const calls = mockResponses(t, [{ data: { jobId: 'abc', status: 'running' } }]);
    const controller = new AbortController();
    await assert.rejects(submitSimulation({}, { signal: controller.signal, onStatus: () => controller.abort() }), { name: 'AbortError' });
    assert.equal(calls.length, 1);
});
