// Docks an AiChatControl on the page's maplibre map and
// wires in the in-process data + app-control tool servers. Renders nothing.
import { useEffect, useState } from 'react';
import { AiChatControl } from '@imaps/ai-chat/maplibre';
import { useTheme } from '../App';
import { getT } from '../constants';
import { useLocalServer } from './useLocalServer';
import { buildDataServer } from './dataServer';
import { buildAppControlServer, useAppController } from './appControl';

const SYSTEM_PROMPT = `You are the assistant inside the World Bank Regional Power Explorer, a pilot with indicative, partly AI-generated, unofficial data.
Answer only from the data__* tools; call data__regions first to resolve names. Name the source and year on every figure.
If a tool says a file is not available, say the explorer has no such data rather than answering from general knowledge.
Plant datasets (OSM, GEM, GPPD) genuinely disagree — say which one a figure comes from and never average them.
Use app__update_state to navigate and filter the map instead of telling the user where to click; use map__* tools for camera moves.`;

/**
 * @param {{ mapRef: React.RefObject<import('maplibre-gl').Map>, mapKey: unknown, ready: boolean, controller: object }} props
 * `mapKey` must change whenever the page recreates its map instance.
 */
// index.css hides .maplibregl-ctrl-bottom-right outright (no attribution wanted); re-show it only when it holds the chat.
const STYLE_ID = 'poc-ai-chat-style';
if (!document.getElementById(STYLE_ID)) {
  const style = Object.assign(document.createElement('style'), { id: STYLE_ID });
  style.textContent = '.maplibregl-ctrl-bottom-right:has(.imaps-ai-chat-ctrl) { display: block !important; }';
  document.head.append(style);
}

/**
 * Paint the chat with the app's active palette. The element's shadow sheet reads
 * shadcn tokens on :host, and custom properties inherit across the shadow
 * boundary, so setting them inline on the element is enough — no package change.
 */
function applyTheme(el, theme) {
  const t = getT(theme);
  el.setAttribute('theme', t.isDark ? 'dark' : 'light');
  const tokens = {
    background: t.panel, foreground: t.text, card: t.cardBg, 'card-foreground': t.text,
    popover: t.panel, 'popover-foreground': t.text,
    primary: t.highlight.fill, 'primary-foreground': '#fff',
    secondary: t.cardBg, 'secondary-foreground': t.text, muted: t.cardBg, 'muted-foreground': t.muted,
    accent: t.cardBg, 'accent-foreground': t.text, border: t.panelBorder, input: t.panelBorder, ring: t.highlight.fill,
    radius: '4px',
  };
  for (const [k, v] of Object.entries(tokens)) el.style.setProperty(`--${k}`, v);
  el.style.fontFamily = "'Segoe UI', system-ui, sans-serif";
  // The shadow sheet is rem-based, so font-size on the host does nothing; this app runs ~0.75rem type.
  el.style.zoom = '0.85';
  // The control chrome lives outside the shadow root and hardcodes maplibre's white ctrl-group + a light frame.
  const panel = el.parentElement, group = panel?.parentElement;
  if (panel) Object.assign(panel.style, { border: `1px solid ${t.panelBorder}`, borderRadius: '6px', background: t.panel });
  if (group) Object.assign(group.style, { background: t.panel, border: `1px solid ${t.panelBorder}`, boxShadow: 'none' });
  const btn = group?.querySelector('.imaps-ai-chat-toggle');
  if (btn) { btn.style.color = t.text; btn.style.background = 'transparent'; }
}

export default function MapChat({ mapRef, mapKey, ready, controller }) {
  useAppController(controller);
  const { theme } = useTheme();
  const dataServers = useLocalServer(buildDataServer, 'data');
  const appServers  = useLocalServer(buildAppControlServer, 'app');
  const [control, setControl] = useState(null);

  useEffect(() => {
    let frame = 0, added = null;
    const tryAdd = () => {
      const map = mapRef.current;
      if (!map) { frame = requestAnimationFrame(tryAdd); return; }
      const ctrl = new AiChatControl({
        label: 'Assistant',
        chat: {
          title: 'Power Explorer Assistant',
          greeting: 'Indicative, not fact-checked. Ask about capacity, generation, trade or access across the explorer\'s data, or tell me where to take the map.',
          placeholder: 'Ask about the data…',
          systemPrompt: SYSTEM_PROMPT,
          defaultProvider: 'anthropic',
          disabledPlaceholder: 'Loading map data…',
          deployment: { storage: 'session', showPricing: false, lock: { fileGeneration: false } },
        },
      });
      map.addControl(ctrl, 'bottom-right');
      added = { map, ctrl };
      setControl(ctrl);
    };
    tryAdd();
    return () => {
      cancelAnimationFrame(frame);
      try { if (added?.map.hasControl(added.ctrl)) added.map.removeControl(added.ctrl); } catch { /* map already removed */ }
      setControl(null);
    };
  }, [mapRef, mapKey]);

  useEffect(() => { if (control) control.localServers = [...dataServers, ...appServers]; }, [control, dataServers, appServers]);
  useEffect(() => { if (control?.element) control.element.disabled = !ready; }, [control, ready]);
  useEffect(() => { if (control?.element) applyTheme(control.element, theme); }, [control, theme]);

  return null;
}
