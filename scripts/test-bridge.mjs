#!/usr/bin/env node
/**
 * Functional tests for the Ammar web bridge and tap behaviour.
 *
 * Loads the inline script of www/index.html in a sandbox with stubbed DOM and
 * Capacitor objects, then exercises every transport path and the tap flow.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const html = fs.readFileSync('www/index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const appScript = scripts[0];

function makeElement() {
  return {
    listeners: {},
    style: {},
    dataset: {},
    classList: {
      set: new Set(),
      add(...names) { names.forEach((n) => this.set.add(n)); },
      remove(...names) { names.forEach((n) => this.set.delete(n)); },
      toggle(name) { this.set.has(name) ? this.set.delete(name) : this.set.add(name); },
      contains(name) { return this.set.has(name); }
    },
    textContent: '',
    offsetWidth: 100,
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    setAttribute() {},
    dispatch(type, event = {}) { (this.listeners[type] || []).forEach((fn) => fn(event)); }
  };
}

function boot({ capacitor, androidBridge, search = '' } = {}) {
  const elements = {
    'ammar-stage': makeElement(),
    'ammar-character': makeElement(),
    'speech-bubble': makeElement(),
    'mouth': makeElement(),
    'eyes': makeElement()
  };
  const timers = [];
  const win = {
    location: { search, protocol: 'https:' },
    navigator: { userAgent: 'test', serviceWorker: undefined },
    Capacitor: capacitor,
    AndroidBridge: androidBridge,
    addEventListener() {},
    console
  };
  const sandbox = {
    window: win,
    document: {
      getElementById: (id) => elements[id],
      body: { classList: makeElement().classList }
    },
    navigator: win.navigator,
    location: win.location,
    URLSearchParams,
    console,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval: () => 0,
    Number,
    Math,
    Promise
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(appScript + '\n;globalThis.__ammar = { AmmarNative, AmmarApp };', sandbox, { filename: 'index.html#inline-1' });
  sandbox.AmmarNative = sandbox.__ammar.AmmarNative;
  sandbox.AmmarApp = sandbox.__ammar.AmmarApp;
  return { sandbox, win, elements };
}

// 1. Official Capacitor.registerPlugin path.
{
  const calls = [];
  const plugin = {
    checkOverlayPermission: async () => ({ granted: false }),
    requestOverlayPermission: async () => ({ granted: true }),
    showAmmar: async (opts) => { calls.push(['showAmmar', opts]); return { showing: true }; },
    hideAmmar: async () => ({ showing: false }),
    moveBy: async (opts) => { calls.push(['moveBy', opts]); return { moved: true }; },
    onAmmarClicked: async () => { calls.push(['onAmmarClicked']); }
  };
  const { sandbox } = boot({
    capacitor: {
      isNativePlatform: () => true,
      registerPlugin: (name) => { assert.equal(name, 'AmmarOverlay'); return plugin; }
    }
  });
  const native = sandbox.AmmarNative;
  assert.equal(native.isAvailable(), true, 'plugin path should be available');
  assert.deepEqual(await native.checkOverlayPermission(), { granted: false });
  assert.deepEqual(await native.show('hi'), { showing: true });
  assert.deepEqual(calls[0], ['showAmmar', { text: 'hi' }]);
  assert.deepEqual(await native.moveBy(500, -500), { moved: true });
  assert.deepEqual(calls[1], ['moveBy', { dx: 240, dy: -240 }], 'steps must clamp to +/-240');
  assert.deepEqual(await native.moveBy('abc', NaN), { moved: true });
  assert.deepEqual(calls[2], ['moveBy', { dx: 0, dy: 0 }], 'invalid numbers become 0');
  await native.notifyClick();
  assert.deepEqual(calls[3], ['onAmmarClicked']);
  console.log('ok  registerPlugin transport + input validation');
}

// 2. No Capacitor at all (plain browser).
{
  const { sandbox } = boot({});
  const native = sandbox.AmmarNative;
  assert.equal(native.isAvailable(), false);
  assert.deepEqual(await native.checkOverlayPermission(), { granted: false, unsupported: true });
  assert.deepEqual(await native.moveBy(10, 10), { moved: false, transport: 'none' });
  assert.deepEqual(await native.show('x'), { showing: false, unsupported: true });
  console.log('ok  graceful degradation without Capacitor');
}

// 3. Capacitor.Plugins fallback.
{
  let used = false;
  const { sandbox } = boot({
    capacitor: {
      isNativePlatform: () => true,
      Plugins: { AmmarOverlay: { moveBy: async () => { used = true; return { moved: true }; } } }
    }
  });
  assert.equal(sandbox.AmmarNative.isAvailable(), true);
  await sandbox.AmmarNative.moveBy(5, 5);
  assert.equal(used, true);
  console.log('ok  Capacitor.Plugins fallback');
}

// 4. nativePromise fallback (bridge without @capacitor/core).
{
  const seen = [];
  const { sandbox } = boot({
    capacitor: {
      isNativePlatform: () => true,
      nativePromise: async (plugin, method, options) => {
        seen.push([plugin, method, options]);
        return { showing: method === 'showAmmar' };
      }
    }
  });
  assert.equal(sandbox.AmmarNative.isAvailable(), true);
  await sandbox.AmmarNative.show('hello');
  assert.deepEqual(seen[0], ['AmmarOverlay', 'showAmmar', { text: 'hello' }]);
  console.log('ok  Capacitor.nativePromise fallback');
}

// 5. Overlay WebView (AndroidBridge JavaScript interface).
{
  const moves = [];
  const clicks = [];
  const { sandbox } = boot({
    search: '?mode=android',
    androidBridge: {
      moveBy: (dx, dy) => moves.push([dx, dy]),
      onAmmarClicked: () => clicks.push('click')
    }
  });
  const native = sandbox.AmmarNative;
  assert.equal(native.isOverlayWebView(), true);
  assert.deepEqual(await native.checkOverlayPermission(), { granted: true });
  assert.deepEqual(await native.moveBy(18, 4), { moved: true, transport: 'javascript-interface' });
  assert.deepEqual(moves[0], [18, 4]);
  await native.notifyClick();
  assert.deepEqual(clicks, ['click']);
  assert.equal(sandbox.AmmarApp.isOverlayMode(), true);
  assert.equal(sandbox.document.body.classList.contains('android-overlay'), true);
  console.log('ok  overlay AndroidBridge transport + overlay mode body class');
}

// 6. Tap interaction: jump class + speech bubble + native notify.
{
  const clicks = [];
  const { sandbox, elements } = boot({
    androidBridge: { moveBy() {}, onAmmarClicked: () => clicks.push('click') }
  });
  elements['ammar-stage'].dispatch('click');
  assert.equal(elements['ammar-character'].classList.contains('jump-anim'), true, 'tap must jump');
  assert.equal(elements['speech-bubble'].classList.contains('visible'), true, 'tap must show the bubble');
  assert.equal(elements['speech-bubble'].textContent.length > 0, true, 'bubble must contain text');
  assert.deepEqual(clicks, ['click']);
  assert.equal(typeof sandbox.window.AmmarOverlay.jump, 'function', 'native must be able to call jump()');
  assert.equal(typeof sandbox.window.AmmarOverlay.say, 'function');
  console.log('ok  tap -> jump + speech bubble + native callback');
}

// 7. Speech bubble text from native evaluateJavascript.
{
  const { sandbox, elements } = boot({ androidBridge: { moveBy() {}, onAmmarClicked() {} } });
  sandbox.window.AmmarOverlay.say('رسالة من الطبقة الأصلية');
  assert.equal(elements['speech-bubble'].textContent, 'رسالة من الطبقة الأصلية');
  console.log('ok  native -> web speech bubble');
}

console.log('\nbridge tests passed');
