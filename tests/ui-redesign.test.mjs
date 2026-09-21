import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/ui/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
const components = fs.readFileSync(new URL('../src/ui/components.tsx', import.meta.url), 'utf8');
const plan = fs.readFileSync(new URL('../docs/ui-redesign-plan.md', import.meta.url), 'utf8');

test('premium UI uses semantic design tokens and shared primitives', () => {
  for (const token of ['--color-bg', '--color-surface', '--color-primary', '--color-success', '--color-warning', '--color-danger', '--radius-md', '--space-4', '--shadow-md', '--transition-fast']) assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(components, /export function Icon/);
  assert.match(components, /export function Button/);
  assert.match(components, /export function StatusBadge/);
  assert.match(components, /export function ProgressBar/);
  assert.match(components, /<path d=\{paths\[name\]\} \/>/);
  assert.doesNotMatch(components, /paths\[name\]\.split/);
});

test('navigation remains feature-complete while using grouped information architecture', () => {
  for (const label of ['التشغيل', 'اختبارات البدء', 'بنك التغريدات', 'الجلسات', 'السجل', 'التحليلات', 'التشخيص', 'مساحات العمل', 'الإعدادات']) assert.match(ui, new RegExp(`label="${label}"`));
  for (const group of ['CONTROL', 'CONTENT', 'ACTIVITY', 'INSIGHTS', 'MANAGE']) assert.match(ui, new RegExp(`>${group}<`));
  assert.match(ui, /aria-current=/);
});

test('premium UI retains no-post and existing runtime safety contracts', () => {
  assert.match(ui, /DRY_RUN_FIRST/);
  assert.match(ui, /RUN_DIAGNOSTICS/);
  assert.match(ui, /type: 'START'/);
  assert.match(ui, /type: 'PAUSE'/);
  assert.match(ui, /type: 'RESUME'/);
  assert.match(ui, /type: 'STOP'/);
  assert.match(ui, /target="_blank"/);
});

test('responsive and reduced-motion rules cover the Side Panel range', () => {
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(plan, /Do not modify service-worker or domain logic/);
});

test('operation view keeps Workspace compact and reveals navigation on hover or focus', () => {
  assert.match(ui, /shell-\$\{activeTab\}/);
  assert.match(css, /\.shell-operation \.tabs-bar:hover \.tabs/);
  assert.match(css, /\.shell-operation \.tabs-bar:focus-within \.tabs/);
  assert.match(css, /\.shell-operation \.premium-switcher/);
  assert.match(css, /@media \(max-height: 700px\)/);
  assert.match(css, /\.shell-operation \.countdown/);
});

test('operation dashboard owns the scheduled and waiting timer display', () => {
  const heroStart = ui.indexOf('className="card operation-hero"');
  const heroEnd = ui.indexOf('</section>', heroStart);
  const hero = ui.slice(heroStart, heroEnd);
  const controlsStart = ui.indexOf('className="card controls"');
  const controlsEnd = ui.indexOf('</section>', controlsStart);
  const controls = ui.slice(controlsStart, controlsEnd);
  assert.match(hero, /dashboard-countdown/);
  assert.match(hero, /formatCountdown\(countdownSeconds\)/);
  assert.doesNotMatch(controls, /dashboard-countdown|formatCountdown\(countdownSeconds\)/);
});
