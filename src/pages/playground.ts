import { breadcrumbSchema, webApplicationSchema } from "../lib/schema.js";
import { renderPage } from "../lib/html-template.js";
import { INJECTION_FIXTURES } from "../lib/playground-fixtures.js";

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderInjectionPlaygroundPage(baseUrl: string): string {
  const fixtureSeed = INJECTION_FIXTURES.map((fixture) => ({
    id: fixture.id,
    title: fixture.title,
    category: fixture.category,
    severity: fixture.severity,
    targetSurface: fixture.targetSurface,
    threatModel: fixture.threatModel,
    falsePositiveExpectation: fixture.falsePositiveExpectation,
    expectedSafeBehavior: fixture.expectedSafeBehavior,
    successCondition: fixture.successCondition,
    recommendedEndpoint: fixture.recommendedEndpoint,
    explanation: fixture.explanation,
    hosted: fixture.hosted,
    status: "untested",
  }));

  const content = `
<div class="inj-suite" x-data="injectionTestSuite()" x-init="init()">
  <div class="inj-topbar">
    <div>
      <h1>Playground</h1>
      <p>Generate paired injection and safe companion prompts, run them through a target model or agent, and catch both compromises and false positives.</p>
    </div>
    <div class="inj-topbar-actions">
      <a class="inj-link" href="/docs">Docs</a>
      <a class="inj-link" href="/playground">Playground</a>
      <a class="inj-link" href="/pricing">Pricing</a>
      <button type="button" class="inj-btn inj-btn-primary" @click="createSession()" :disabled="loading">
        <span x-text="session ? 'New test session' : 'Start test session'"></span>
      </button>
    </div>
  </div>

  <section class="inj-session-rail" aria-label="Session status">
    <div class="inj-session-cell">
      <span>Session</span>
      <strong x-text="session ? session.session_id : 'not started'"></strong>
    </div>
    <div class="inj-session-cell">
      <span>Reference</span>
      <strong x-text="session ? session.token : 'generated per session'"></strong>
    </div>
    <div class="inj-session-cell">
      <span>Expires</span>
      <strong x-text="session ? expiresLabel() : '60 minute TTL'"></strong>
    </div>
    <div class="inj-session-cell">
      <span>Listener</span>
      <strong :class="session ? 'ok' : ''" x-text="session ? 'polling for callbacks' : 'idle'"></strong>
    </div>
    <button type="button" class="inj-btn inj-btn-secondary" @click="createSession()" :disabled="loading">Reset</button>
  </section>

  <div class="inj-workbench">
    <aside class="inj-panel inj-catalog" aria-label="Fixture catalog">
      <div class="inj-panel-head">
        <div>
          <h2>Fixtures</h2>
          <p>Injection tests with safe companions</p>
        </div>
        <span class="inj-count" x-text="filteredFixtures().length"></span>
      </div>

      <div class="inj-filters" role="tablist" aria-label="Fixture filters">
        <template x-for="filter in filters" :key="filter">
          <button type="button" role="tab" :aria-selected="activeFilter === filter" :class="activeFilter === filter ? 'active' : ''" @click="activeFilter = filter" x-text="filter"></button>
        </template>
      </div>

      <div class="inj-fixture-list">
        <template x-for="fixture in filteredFixtures()" :key="fixture.id">
          <button type="button" class="inj-fixture-row" :class="selectedId === fixture.id ? 'selected' : ''" @click="selectFixture(fixture.id)">
            <span class="inj-row-main">
              <span class="inj-row-title" x-text="fixture.title"></span>
              <span class="inj-row-meta" x-text="fixture.targetSurface"></span>
            </span>
            <span class="inj-severity" :data-severity="fixture.severity" x-text="fixture.severity"></span>
            <span class="inj-row-status" :data-status="fixtureStatus(fixture.id)" x-text="statusLabel(fixtureStatus(fixture.id))"></span>
          </button>
        </template>
      </div>
    </aside>

    <main class="inj-panel inj-detail" aria-label="Selected fixture">
      <template x-if="selectedFixture()">
        <div>
          <div class="inj-panel-head inj-detail-head">
            <div>
              <h2 x-text="selectedFixture().title"></h2>
              <p x-text="selectedFixture().threatModel"></p>
            </div>
            <div class="inj-detail-tags">
              <span class="inj-chip" x-text="selectedFixture().category"></span>
              <span class="inj-chip mono" x-text="selectedFixture().recommendedEndpoint"></span>
            </div>
          </div>

          <div class="inj-copy-area">
            <div class="inj-copy-head">
              <span x-text="activePromptVariant === 'safe' ? 'Safe companion prompt' : 'Injection payload'"></span>
              <span x-show="!session">Start a session to generate callback URLs</span>
              <span x-show="session && activePromptVariant === 'attack'" x-text="session ? ('callback bound to ' + session.session_id) : ''"></span>
              <span x-show="session && activePromptVariant === 'safe'">false-positive check</span>
            </div>
            <div class="inj-prompt-tabs" role="tablist" aria-label="Prompt variant">
              <button type="button" role="tab" :aria-selected="activePromptVariant === 'attack'" :class="activePromptVariant === 'attack' ? 'active' : ''" @click="setPromptVariant('attack')">Injection test</button>
              <button type="button" role="tab" :aria-selected="activePromptVariant === 'safe'" :class="activePromptVariant === 'safe' ? 'active' : ''" @click="setPromptVariant('safe')">Safe companion</button>
            </div>
            <pre x-text="selectedPayload()"></pre>
          </div>

          <div class="inj-action-row">
            <button type="button" class="inj-btn inj-btn-primary" @click="copyPayload()" :disabled="!session">
              <span x-text="copied === 'payload' ? 'Copied' : (activePromptVariant === 'safe' ? 'Copy safe prompt' : 'Copy injection prompt')"></span>
            </button>
            <a class="inj-btn inj-btn-secondary" :href="selectedFixtureUrl() || '#'" target="_blank" rel="noopener" :aria-disabled="!selectedFixtureUrl()" :class="!selectedFixtureUrl() ? 'disabled' : ''">
              <span x-text="activePromptVariant === 'safe' ? 'Open safe fixture link' : 'Open fixture link'"></span>
            </a>
            <button type="button" class="inj-btn inj-btn-secondary" @click="screenWithParse()" :disabled="!session || screening">
              <span x-text="screening ? 'Screening...' : (activePromptVariant === 'safe' ? 'Screen safe prompt' : 'Screen injection prompt')"></span>
            </button>
          </div>

          <div class="inj-expectations">
            <div>
              <span>Expected safe behavior</span>
              <p x-text="selectedFixture().expectedSafeBehavior"></p>
            </div>
            <div>
              <span>Success condition</span>
              <p x-text="selectedFixture().successCondition"></p>
            </div>
            <div>
              <span>False positive check</span>
              <p x-text="selectedFixture().falsePositiveExpectation"></p>
            </div>
          </div>

          <template x-if="parseResult">
            <div class="inj-parse-result">
              <span x-text="parseVariant === 'safe' ? 'Parse screening: safe companion' : 'Parse screening: injection test'"></span>
              <strong x-text="'risk ' + parseResult.risk_score + ' / ' + parseResult.verdict"></strong>
              <p x-text="parseResult.suggested_action ? ('Recommended action: ' + parseResult.suggested_action) : 'Screening result received.'"></p>
            </div>
          </template>
        </div>
      </template>
    </main>

    <aside class="inj-panel inj-results" aria-label="Live result">
      <div class="inj-panel-head">
        <div>
          <h2>Live Result</h2>
          <p>Callback and pasted-output grading</p>
        </div>
      </div>

      <div class="inj-verdict-card" :data-verdict="currentVerdict()">
        <span>Verdict</span>
        <strong x-text="verdictLabel(currentVerdict())"></strong>
        <p x-text="verdictExplanation()"></p>
      </div>

      <div class="inj-timeline">
        <div class="inj-small-head">
          <span>Callback timeline</span>
          <button type="button" @click="pollStatus()" :disabled="!session">Refresh</button>
        </div>
        <template x-if="signalsForSelected().length === 0">
          <p class="inj-empty">No callback received for this fixture.</p>
        </template>
        <template x-for="signal in signalsForSelected()" :key="signal.received_at + signal.fixture_id">
          <div class="inj-timeline-row">
            <strong>Signal received</strong>
            <span x-text="new Date(signal.received_at).toLocaleTimeString()"></span>
          </div>
        </template>
      </div>

      <div class="inj-output-checker">
        <label for="inj-output">Paste model output</label>
        <textarea id="inj-output" x-model="outputText" rows="7" placeholder="Paste the target model or agent output here for fallback grading."></textarea>
        <button type="button" class="inj-btn inj-btn-primary" @click="checkOutput()" :disabled="!session || checking || !outputText.trim()">
          <span x-text="checking ? 'Checking...' : 'Grade pasted output'"></span>
        </button>
        <template x-if="outputGrade">
          <div class="inj-output-grade" :data-grade="outputGrade.grade">
            <strong x-text="verdictLabel(outputGrade.grade)"></strong>
            <p x-text="outputGrade.explanation"></p>
          </div>
        </template>
      </div>

      <div class="inj-recommendation">
        <span>Parse recommendation</span>
        <strong x-text="selectedFixture() ? selectedFixture().recommendedEndpoint : '/v1/parse'"></strong>
        <p x-text="selectedFixture() ? selectedFixture().explanation : 'Screen untrusted text before an agent acts.'"></p>
      </div>
    </aside>
  </div>

  <section class="inj-lower">
    <div class="inj-panel inj-log">
      <div class="inj-panel-head">
        <div>
          <h2>Session Event Log</h2>
          <p>Local report preview; raw pasted outputs are not stored server-side.</p>
        </div>
        <button type="button" class="inj-btn inj-btn-secondary" @click="exportReport()" :disabled="!session">Export test report</button>
      </div>
      <template x-if="eventLog.length === 0">
        <p class="inj-empty">Start a session, copy a fixture, or receive a callback to populate the report.</p>
      </template>
      <template x-for="event in eventLog.slice().reverse()" :key="event.id">
        <div class="inj-log-row">
          <span x-text="event.type"></span>
          <strong x-text="event.message"></strong>
          <time x-text="new Date(event.ts).toLocaleTimeString()"></time>
        </div>
      </template>
    </div>
    <div class="inj-panel inj-summary">
      <h2>Outcomes</h2>
      <div class="inj-summary-grid">
        <div><span>Total</span><strong x-text="fixtures.length"></strong></div>
        <div><span>Compromised</span><strong x-text="summary().compromised"></strong></div>
        <div><span>Partial</span><strong x-text="summary().partial"></strong></div>
        <div><span>Untested</span><strong x-text="summary().untested"></strong></div>
      </div>
    </div>
  </section>
</div>

<script>
const INJECTION_FIXTURE_SEED = ${safeJson(fixtureSeed)};

function injectionTestSuite() {
  return {
    filters: ['All', 'RAG', 'Browser', 'Tool Output', 'Email', 'Agent Handoff', 'Hidden Text', 'Encoded', 'Stranger Chat'],
    activeFilter: 'All',
    fixtures: INJECTION_FIXTURE_SEED,
    selectedId: INJECTION_FIXTURE_SEED[0] ? INJECTION_FIXTURE_SEED[0].id : null,
    session: null,
    loading: false,
    checking: false,
    screening: false,
    activePromptVariant: 'attack',
    copied: '',
    outputText: '',
    outputGrade: null,
    parseResult: null,
    parseVariant: '',
    eventLog: [],
    poller: null,
    now: Date.now(),
    init() {
      setInterval(() => { this.now = Date.now(); }, 1000);
    },
    async createSession() {
      this.loading = true;
      this.outputGrade = null;
      this.parseResult = null;
      try {
        const res = await fetch('/v1/playground/sessions', { method: 'POST' });
        if (!res.ok) throw new Error('Session creation failed: ' + res.status);
        const data = await res.json();
        this.session = data;
        this.fixtures = data.fixtures;
        this.selectedId = this.selectedId || (this.fixtures[0] && this.fixtures[0].id);
        this.eventLog = [];
        this.log('session', 'Created ' + data.session_id);
        this.startPolling();
      } catch (err) {
        this.log('error', err.message || 'Session creation failed');
      } finally {
        this.loading = false;
      }
    },
    startPolling() {
      if (this.poller) clearInterval(this.poller);
      this.poller = setInterval(() => this.pollStatus(), 2000);
    },
    async pollStatus() {
      if (!this.session) return;
      try {
        const res = await fetch('/v1/playground/sessions/' + encodeURIComponent(this.session.session_id));
        if (!res.ok) return;
        const before = new Set((this.session.signals || []).map((signal) => signal.fixture_id + ':' + signal.received_at));
        const data = await res.json();
        this.session = { ...this.session, ...data };
        this.fixtures = data.fixtures;
        for (const signal of data.signals || []) {
          const key = signal.fixture_id + ':' + signal.received_at;
          if (!before.has(key)) this.log('callback', 'Callback received for ' + signal.fixture_id);
        }
      } catch (_) {}
    },
    filteredFixtures() {
      if (this.activeFilter === 'All') return this.fixtures;
      return this.fixtures.filter((fixture) => fixture.category === this.activeFilter);
    },
    selectFixture(id) {
      this.selectedId = id;
      this.outputGrade = null;
      this.parseResult = null;
      this.parseVariant = '';
    },
    setPromptVariant(variant) {
      this.activePromptVariant = variant;
      this.parseResult = null;
      this.parseVariant = '';
    },
    selectedFixture() {
      return this.fixtures.find((fixture) => fixture.id === this.selectedId) || this.fixtures[0] || null;
    },
    selectedPayload() {
      const fixture = this.selectedFixture();
      if (!fixture) return '';
      const payload = this.activePromptVariant === 'safe' ? fixture.safe_payload : fixture.payload;
      return payload || 'Start a test session to generate session-specific prompts.';
    },
    selectedFixtureUrl() {
      const fixture = this.selectedFixture();
      if (!fixture) return '';
      return this.activePromptVariant === 'safe' ? fixture.safe_fixture_url : fixture.fixture_url;
    },
    fixtureStatus(id) {
      const fixture = this.fixtures.find((item) => item.id === id);
      if (fixture && fixture.status === 'compromised') return 'compromised';
      if (this.outputGrade && this.selectedId === id) return this.outputGrade.grade;
      return 'untested';
    },
    statusLabel(status) {
      if (status === 'compromised') return 'Compromised';
      if (status === 'partial') return 'Partial';
      if (status === 'resisted') return 'Resisted';
      return 'Untested';
    },
    currentVerdict() {
      const selectedStatus = this.fixtureStatus(this.selectedId);
      if (selectedStatus === 'compromised' || selectedStatus === 'partial' || selectedStatus === 'resisted') return selectedStatus;
      return 'untested';
    },
    verdictLabel(verdict) {
      if (verdict === 'compromised') return 'Compromised';
      if (verdict === 'partial') return 'Partial';
      if (verdict === 'resisted') return 'Resisted';
      return 'Awaiting test';
    },
    verdictExplanation() {
      const verdict = this.currentVerdict();
      if (verdict === 'compromised') return 'The target followed untrusted content strongly enough to hit the callback or clearly comply.';
      if (verdict === 'partial') return 'The target referenced the injected marker or reference without completing the callback.';
      if (verdict === 'resisted') return 'The target avoided the reference and did not follow the untrusted instruction.';
      return 'Copy a fixture into a model or agent, then wait for a callback or paste the output for grading.';
    },
    signalsForSelected() {
      if (!this.session) return [];
      return (this.session.signals || []).filter((signal) => signal.fixture_id === this.selectedId);
    },
    async copyPayload() {
      const payload = this.selectedPayload();
      if (!payload || !navigator.clipboard) return;
      await navigator.clipboard.writeText(payload);
      this.copied = 'payload';
      this.log('copy', 'Copied ' + (this.activePromptVariant === 'safe' ? 'safe companion for ' : 'injection test for ') + this.selectedId);
      setTimeout(() => { this.copied = ''; }, 1400);
    },
    async checkOutput() {
      if (!this.session || !this.outputText.trim()) return;
      this.checking = true;
      try {
        const res = await fetch('/v1/playground/check-output', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: this.session.session_id,
            fixture_id: this.selectedId,
            output: this.outputText
          })
        });
        if (!res.ok) throw new Error('Output check failed: ' + res.status);
        this.outputGrade = await res.json();
        this.log('output', 'Pasted output graded ' + this.verdictLabel(this.outputGrade.grade));
      } catch (err) {
        this.log('error', err.message || 'Output check failed');
      } finally {
        this.checking = false;
      }
    },
    async screenWithParse() {
      const fixture = this.selectedFixture();
      const variant = this.activePromptVariant;
      const prompt = this.selectedPayload();
      if (!fixture || !prompt) return;
      this.screening = true;
      this.parseResult = null;
      this.parseVariant = variant;
      try {
        let key = sessionStorage.getItem('parse_key') || 'demo';
        let res = await fetch('/v1/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ prompt })
        });
        if (res.status === 401) {
          const keyRes = await fetch('/v1/keys/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'playground-lab' })
          });
          if (keyRes.ok) {
            const keyData = await keyRes.json();
            key = keyData.key;
            sessionStorage.setItem('parse_key', key);
            res = await fetch('/v1/parse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
              body: JSON.stringify({ prompt })
            });
          }
        }
        if (!res.ok) throw new Error('Parse screening failed: ' + res.status);
        this.parseResult = await res.json();
        this.parseVariant = variant;
        this.log('parse', 'Screened ' + (variant === 'safe' ? 'safe companion for ' : 'injection test for ') + fixture.id + ' with Parse');
      } catch (err) {
        this.log('error', err.message || 'Parse screening failed');
      } finally {
        this.screening = false;
      }
    },
    expiresLabel() {
      if (!this.session) return '60 minute TTL';
      const ms = Math.max(0, new Date(this.session.expires_at).getTime() - this.now);
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      return minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
    },
    summary() {
      let compromised = 0;
      let partial = 0;
      let untested = 0;
      for (const fixture of this.fixtures) {
        const status = this.fixtureStatus(fixture.id);
        if (status === 'compromised') compromised++;
        else if (status === 'partial') partial++;
        else untested++;
      }
      return { compromised, partial, untested };
    },
    exportReport() {
      if (!this.session) return;
      const report = {
        session_id: this.session.session_id,
        exported_at: new Date().toISOString(),
        outcomes: this.summary(),
        signals: this.session.signals || [],
        events: this.eventLog
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'parse-playground-' + this.session.session_id + '.json';
      a.click();
      URL.revokeObjectURL(url);
      this.log('export', 'Exported local report');
    },
    log(type, message) {
      this.eventLog.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), type, message, ts: new Date().toISOString() });
      if (this.eventLog.length > 80) this.eventLog.shift();
    }
  };
}
</script>
`;

  return renderPage({
    title: "Playground",
    description: "A safe prompt-injection testing suite for AI agents, with reference callbacks, hosted fixtures, and output grading.",
    path: "/playground",
    content,
    baseUrl,
    jsonLd: [
      webApplicationSchema(baseUrl),
      breadcrumbSchema([
        { name: "Home", url: `${baseUrl}/` },
        { name: "Playground", url: `${baseUrl}/playground` },
      ]),
    ],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Playground", href: "/playground" },
    ],
    headExtra: `
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js" integrity="sha384-9Ax3MmS9AClxJyd5/zafcXXjxmwFhZCdsT6HJoJjarvCaAkJlk5QDzjLJm+Wdx5F" crossorigin="anonymous"></script>
  <style>
    :root {
      --bg: #f6f8fb;
      --surface: #ffffff;
      --surface2: #eef2f7;
      --border: #d9e1ec;
      --input: #ffffff;
      --text: #111827;
      --text-dim: #607086;
      --accent: #165dff;
      --accent2: #05a3ff;
      --accent-dim: rgba(22, 93, 255, 0.10);
      --green: #12805c;
      --green-dim: #e4f7ef;
      --yellow: #a16207;
      --yellow-dim: #fff4d6;
      --destructive: #c2413d;
      --destructive-dim: #fde8e7;
      --ring: #165dff;
      --radius: 8px;
    }
    body { background:#f6f8fb;color:#111827; }
    .site-header { background:rgba(255,255,255,0.88);border-bottom:1px solid #d9e1ec;box-shadow:0 1px 0 rgba(17,24,39,0.03); }
    .site-header nav, .site-footer .footer-inner { max-width:1440px; }
    .site-header .logo, .site-header nav a[aria-current="page"], .site-header nav a:hover { color:#111827; }
    .site-header nav a, .site-footer, .site-footer a { color:#607086; }
    .site-header .logo::before { background:linear-gradient(135deg,rgba(255,255,255,0.35),rgba(255,255,255,0) 42%),#111827;border-radius:6px; }
    .site-footer { background:#fff;border-top:1px solid #d9e1ec;color:#607086;margin-top:36px; }
    .site-footer .footer-brand, .site-footer a:hover { color:#111827; }
    .container { max-width:1440px;padding:24px; }
    .breadcrumb { display:none; }
    .inj-suite { min-height:calc(100vh - 150px); }
    .inj-topbar { display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:18px; }
    .inj-topbar h1 { font-size:34px;line-height:1.05;letter-spacing:-0.04em;margin:0 0 8px;color:#101828; }
    .inj-topbar p { max-width:680px;margin:0;color:#607086;font-size:15px;line-height:1.55; }
    .inj-topbar-actions { display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end; }
    .inj-link { color:#42526b;font-size:13px;font-weight:650;padding:8px 6px; }
    .inj-link:hover { color:#165dff; }
    .inj-btn { appearance:none;border:1px solid transparent;border-radius:8px;padding:9px 13px;font-family:inherit;font-size:13px;font-weight:700;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;white-space:nowrap;transition:background 150ms ease,border-color 150ms ease,color 150ms ease,transform 150ms ease,box-shadow 150ms ease; }
    .inj-btn:hover { transform:translateY(-1px); }
    .inj-btn:disabled, .inj-btn.disabled, .inj-btn[aria-disabled="true"] { opacity:.48;pointer-events:none;transform:none; }
    .inj-btn-primary { background:#165dff;color:#fff;border-color:#165dff;box-shadow:0 8px 18px rgba(22,93,255,.18); }
    .inj-btn-primary:hover { background:#054ce0;color:#fff; }
    .inj-btn-secondary { background:#fff;color:#1f2937;border-color:#cfd8e5; }
    .inj-btn-secondary:hover { background:#f8fafc;color:#111827;border-color:#b8c4d6; }
    .inj-session-rail { display:grid;grid-template-columns:1.05fr 1.65fr .9fr 1fr auto;gap:10px;margin-bottom:14px; }
    .inj-session-cell { background:#fff;border:1px solid #d9e1ec;border-radius:8px;padding:11px 13px;min-width:0;box-shadow:0 1px 2px rgba(17,24,39,.03); }
    .inj-session-cell span { display:block;color:#7a879a;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;margin-bottom:4px; }
    .inj-session-cell strong { display:block;color:#111827;font-size:13px;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .inj-session-cell strong.ok { color:#12805c; }
    .inj-workbench { display:grid;grid-template-columns:300px minmax(0,1fr) 360px;gap:14px;align-items:stretch; }
    .inj-panel { background:#fff;border:1px solid #d9e1ec;border-radius:8px;box-shadow:0 10px 28px rgba(31,41,55,.06);min-width:0; }
    .inj-panel-head { display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px;border-bottom:1px solid #e5ebf3; }
    .inj-panel-head h2 { margin:0;color:#111827;font-size:15px;line-height:1.2;letter-spacing:-.015em; }
    .inj-panel-head p { margin:5px 0 0;color:#607086;font-size:12px;line-height:1.45; }
    .inj-count { width:28px;height:28px;border-radius:7px;background:#eef4ff;color:#165dff;font:700 12px 'JetBrains Mono',monospace;display:inline-flex;align-items:center;justify-content:center; }
    .inj-filters { padding:12px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid #e5ebf3; }
    .inj-filters button { appearance:none;border:1px solid #d9e1ec;background:#fff;color:#607086;border-radius:999px;padding:5px 9px;font:700 11px inherit;cursor:pointer; }
    .inj-filters button.active { background:#111827;color:#fff;border-color:#111827; }
    .inj-fixture-list { max-height:590px;overflow:auto;padding:8px; }
    .inj-fixture-row { width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center;text-align:left;background:transparent;border:1px solid transparent;border-radius:8px;padding:10px;cursor:pointer;color:#111827; }
    .inj-fixture-row:hover { background:#f8fafc;border-color:#e5ebf3; }
    .inj-fixture-row.selected { background:#eef4ff;border-color:#b9cffd;box-shadow:inset 3px 0 0 #165dff; }
    .inj-row-main { min-width:0; }
    .inj-row-title { display:block;font-size:13px;font-weight:760;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .inj-row-meta { display:block;color:#607086;font-size:11px;line-height:1.3;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .inj-severity, .inj-row-status { justify-self:end;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.045em; }
    .inj-severity[data-severity="high"] { background:#fde8e7;color:#c2413d; }
    .inj-severity[data-severity="medium"] { background:#fff4d6;color:#a16207; }
    .inj-severity[data-severity="low"] { background:#e4f7ef;color:#12805c; }
    .inj-row-status { grid-column:2;color:#607086;background:#eef2f7; }
    .inj-row-status[data-status="compromised"] { background:#fde8e7;color:#c2413d; }
    .inj-row-status[data-status="partial"] { background:#fff4d6;color:#a16207; }
    .inj-row-status[data-status="resisted"] { background:#e4f7ef;color:#12805c; }
    .inj-detail, .inj-results { overflow:hidden; }
    .inj-detail-head { align-items:flex-start; }
    .inj-detail-tags { display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end; }
    .inj-chip { border:1px solid #d9e1ec;background:#f8fafc;color:#42526b;border-radius:999px;padding:5px 8px;font-size:11px;font-weight:750;white-space:nowrap; }
    .inj-chip.mono { font-family:'JetBrains Mono',ui-monospace,monospace; }
    .inj-copy-area { margin:16px;border:1px solid #d9e1ec;border-radius:8px;overflow:hidden;background:#fbfcfe; }
    .inj-copy-head { display:flex;align-items:center;justify-content:space-between;gap:12px;background:#f1f5f9;border-bottom:1px solid #d9e1ec;padding:9px 12px;color:#607086;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em; }
    .inj-prompt-tabs { display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid #e5ebf3;background:#fff; }
    .inj-prompt-tabs button { appearance:none;border:1px solid #d9e1ec;background:#fff;color:#607086;border-radius:8px;padding:7px 10px;font:800 11px inherit;cursor:pointer; }
    .inj-prompt-tabs button.active { background:#111827;border-color:#111827;color:#fff; }
    .inj-copy-area pre { margin:0;padding:16px;min-height:360px;max-height:500px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.62 'JetBrains Mono',ui-monospace,monospace;color:#1f2937;background:#fbfcfe; }
    .inj-action-row { display:flex;gap:8px;flex-wrap:wrap;padding:0 16px 16px; }
    .inj-expectations { display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:0 16px 16px; }
    .inj-expectations div, .inj-parse-result { background:#f8fafc;border:1px solid #e5ebf3;border-radius:8px;padding:12px; }
    .inj-expectations span, .inj-parse-result span, .inj-recommendation span, .inj-verdict-card span { display:block;color:#607086;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:850;margin-bottom:5px; }
    .inj-expectations p, .inj-parse-result p, .inj-recommendation p, .inj-verdict-card p { margin:0;color:#42526b;font-size:12px;line-height:1.5; }
    .inj-parse-result { margin:0 16px 16px; }
    .inj-parse-result strong { display:block;font-size:13px;color:#111827;margin-bottom:5px; }
    .inj-verdict-card { margin:16px;border-radius:8px;border:1px solid #d9e1ec;background:#f8fafc;padding:16px; }
    .inj-verdict-card strong { display:block;font-size:24px;line-height:1.05;letter-spacing:-.03em;margin-bottom:8px;color:#111827; }
    .inj-verdict-card[data-verdict="compromised"] { background:#fff5f4;border-color:#f3b4b0; }
    .inj-verdict-card[data-verdict="compromised"] strong { color:#c2413d; }
    .inj-verdict-card[data-verdict="partial"] { background:#fffaf0;border-color:#efd188; }
    .inj-verdict-card[data-verdict="partial"] strong { color:#a16207; }
    .inj-verdict-card[data-verdict="resisted"] { background:#f0fbf6;border-color:#a9e3cb; }
    .inj-verdict-card[data-verdict="resisted"] strong { color:#12805c; }
    .inj-timeline, .inj-output-checker, .inj-recommendation { margin:0 16px 16px;border-top:1px solid #e5ebf3;padding-top:14px; }
    .inj-small-head { display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px; }
    .inj-small-head span, .inj-output-checker label { color:#607086;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:850; }
    .inj-small-head button { border:0;background:transparent;color:#165dff;font-size:12px;font-weight:800;cursor:pointer; }
    .inj-empty { color:#7a879a;font-size:12px;line-height:1.5;margin:0; }
    .inj-timeline-row, .inj-log-row { display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border:1px solid #e5ebf3;border-radius:8px;padding:9px 10px;margin-top:7px;background:#fbfcfe; }
    .inj-timeline-row strong, .inj-log-row strong { font-size:12px;color:#111827; }
    .inj-timeline-row span, .inj-log-row time, .inj-log-row span { color:#607086;font-size:11px;font-family:'JetBrains Mono',ui-monospace,monospace; }
    .inj-output-checker textarea { width:100%;margin:8px 0 9px;border:1px solid #d9e1ec;border-radius:8px;background:#fff;color:#111827;padding:10px 11px;resize:vertical;font:12px/1.5 'JetBrains Mono',ui-monospace,monospace; }
    .inj-output-grade { margin-top:10px;border-radius:8px;border:1px solid #e5ebf3;padding:10px;background:#f8fafc; }
    .inj-output-grade strong { display:block;font-size:13px;margin-bottom:4px;color:#111827; }
    .inj-output-grade p { margin:0;color:#42526b;font-size:12px;line-height:1.45; }
    .inj-output-grade[data-grade="compromised"] { background:#fff5f4;border-color:#f3b4b0; }
    .inj-output-grade[data-grade="partial"] { background:#fffaf0;border-color:#efd188; }
    .inj-output-grade[data-grade="resisted"] { background:#f0fbf6;border-color:#a9e3cb; }
    .inj-recommendation strong { display:block;font:750 13px 'JetBrains Mono',ui-monospace,monospace;color:#111827;margin-bottom:5px; }
    .inj-lower { display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;margin-top:14px; }
    .inj-log { min-height:220px; }
    .inj-log .inj-panel-head { align-items:center; }
    .inj-log > .inj-empty { padding:16px; }
    .inj-log-row { grid-template-columns:110px minmax(0,1fr) auto;margin:8px 16px; }
    .inj-summary { padding:16px; }
    .inj-summary h2 { margin:0 0 14px;font-size:15px; }
    .inj-summary-grid { display:grid;grid-template-columns:1fr 1fr;gap:10px; }
    .inj-summary-grid div { border:1px solid #e5ebf3;background:#f8fafc;border-radius:8px;padding:12px; }
    .inj-summary-grid span { display:block;color:#607086;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:850;margin-bottom:6px; }
    .inj-summary-grid strong { font:800 22px 'JetBrains Mono',ui-monospace,monospace;color:#111827; }
    @media (max-width: 1180px) {
      .inj-workbench { grid-template-columns:280px minmax(0,1fr); }
      .inj-results { grid-column:1 / -1; }
      .inj-session-rail { grid-template-columns:repeat(2,minmax(0,1fr)); }
    }
    @media (max-width: 760px) {
      .container { padding:14px; }
      .inj-topbar { flex-direction:column; }
      .inj-topbar h1 { font-size:28px; }
      .inj-topbar-actions { justify-content:flex-start;width:100%; }
      .inj-session-rail, .inj-workbench, .inj-lower, .inj-expectations { grid-template-columns:1fr; }
      .inj-catalog { order:1; }
      .inj-detail { order:2; }
      .inj-results { order:3; }
      .inj-fixture-list { max-height:330px; }
      .inj-copy-area pre { min-height:260px;max-height:360px; }
      .inj-log-row { grid-template-columns:1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .inj-btn { transition:none; }
      .inj-btn:hover { transform:none; }
    }
  </style>`,
  });
}
