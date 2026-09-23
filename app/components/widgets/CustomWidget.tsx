'use client';
import { useEffect, useRef, useState } from 'react';
import { validateState, type Widget } from '@/app/lib/widgets/model';

const escapeJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
type Props = {
  widget: Widget;
  onState: (state: Widget['state']) => void;
  fallback: React.ReactNode;
};
function makeDocument(widget: Widget, nonce: string) {
  const visual = widget.definition.module;
  if (!visual) return '';
  const page = widget.definition.kind === 'page';
  const bootstrap = `const channel=${escapeJson(nonce)}; const send=(type,value)=>window.parent.postMessage({channel,type,value},'*');
      const initial=${escapeJson(widget.state.custom ?? {})};
      const homeboard=Object.freeze({data:${escapeJson(widget.snapshot.data.content ?? {})},state:initial,setState(value){Object.assign(initial,value);send('state',{...initial})}});
      window.addEventListener('error',()=>send('error'));window.addEventListener('unhandledrejection',()=>send('error'));
      ${page ? `document.querySelectorAll('img').forEach(i=>i.addEventListener('error',()=>(i.closest('figure')||i).remove()));` : ''}
      try{(function(homeboard){'use strict';${visual.js}\n})(homeboard);send('ready')}catch{send('error')}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${page ? 'https: data:' : 'data:'}; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'"><style>:root{--background:#ffffff;--foreground:#0e1526;--primary:#0e1526;--muted:#edf1f5;--border:#dfe5ec;--accent:#0430eb;color-scheme:light}*{box-sizing:border-box}body{margin:0;color:var(--foreground);background:var(--background);font:18px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}h1,h2,h3{font-family:'Avenir Next',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;letter-spacing:-.02em}button,input,select{font:inherit;min-height:48px;max-width:100%}button{background:var(--primary);color:white;border:0;border-radius:12px;padding:10px 16px}svg,canvas{max-width:100%}*:focus-visible{outline:3px solid var(--accent);outline-offset:3px}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}${page ? 'body{padding:16px}img{max-width:100%;height:auto;display:block}figure{margin:0}' : ''}${visual.css.replace(/<\/style/gi, '')}</style></head><body>${visual.html}<script nonce="${nonce}">${bootstrap}</script></body></html>`;
}

function SandboxFrame({ widget, onState, fallback }: Props) {
  const frame = useRef<HTMLIFrameElement>(null),
    handler = useRef(onState);
  const [failed, setFailed] = useState(false),
    [ready, setReady] = useState(false);
  // Freeze the boot document for this activation. State updates must not reload the iframe.
  const [{ nonce, document }] = useState(() => {
    const nonce = crypto.randomUUID().replaceAll('-', '');
    return { nonce, document: makeDocument(widget, nonce) };
  });
  useEffect(() => {
    handler.current = onState;
  }, [onState]);
  useEffect(() => {
    let calls = 0,
      windowStart = Date.now();
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        event.data?.channel !== nonce
      )
        return;
      if (event.data.type === 'ready') {
        setReady(true);
        return;
      }
      if (event.data.type === 'error') {
        setFailed(true);
        return;
      }
      if (event.data.type !== 'state') return;
      if (Date.now() - windowStart > 1000) {
        calls = 0;
        windowStart = Date.now();
      }
      if (++calls > 5) return;
      try {
        handler.current(validateState({ custom: event.data.value }));
      } catch {
        setFailed(true);
      }
    };
    window.addEventListener('message', receive);
    const timeout = window.setTimeout(() => {
      if (!frame.current?.dataset.ready) setFailed(true);
    }, 7000);
    return () => {
      window.removeEventListener('message', receive);
      clearTimeout(timeout);
    };
  }, [nonce]);
  return (
    <>
      {!failed && (
        <iframe
          ref={frame}
          title={`${widget.title} interactive visual`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          srcDoc={document}
          data-kind={widget.definition.kind}
          data-ready={ready ? 'yes' : undefined}
        />
      )}
      {(failed || !ready) && (
        <div className="custom-fallback">
          {failed && (
            <p className="widget-note">
              The interactive visual couldn’t start. Here’s the readable
              version.
            </p>
          )}
          {fallback}
        </div>
      )}
    </>
  );
}

export function CustomWidget({
  widget,
  active,
  onState,
  fallback,
}: Props & { active: boolean }) {
  const anchor = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '50px' },
    );
    if (anchor.current) observer.observe(anchor.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="custom-widget" ref={anchor}>
      {active && visible ? (
        <SandboxFrame
          key={`${widget.definitionId}:${widget.snapshot.fetchedAt}`}
          {...{ widget, onState, fallback }}
        />
      ) : (
        <div className="custom-fallback">
          {!active && (
            <p className="widget-note">
              Open this widget to use its interactive visual.
            </p>
          )}
          {fallback}
        </div>
      )}
    </div>
  );
}
