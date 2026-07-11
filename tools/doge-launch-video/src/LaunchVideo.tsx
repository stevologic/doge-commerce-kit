import React from 'react';
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

type Highlight = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
};

type FeatureScene = {
  slug: string;
  kicker: string;
  title: string;
  copy: string;
  proof: string;
  accent: string;
  highlight: Highlight;
  stats: [string, string, string];
};

const fps = 30;
const imageWidth = 1440;
const imageHeight = 980;
const ink = '#171715';
const paper = '#fffdf6';
const gold = '#f4bd2a';
const teal = '#0f8f78';
const deepTeal = '#0e5b63';
const mint = '#bfeadf';
const rose = '#c64763';
const purple = '#6354c9';

const pageImage = (slug: string) => staticFile(`pages/${slug}.png`);
const dogeLogo = staticFile('doge-logo-256.png');

const features: FeatureScene[] = [
  {
    slug: 'wallet',
    kicker: 'Wallet',
    title: 'Save or check a Dogecoin wallet.',
    copy: 'Generate a local test wallet, load a watch-only address, and check the live blockchain balance before checkout.',
    proof: 'Watch-only balance checks keep the merchant in control.',
    accent: teal,
    highlight: {x: 76, y: 338, w: 586, h: 370, label: 'wallet controls + live balance'},
    stats: ['QR receive URI', 'Browser save', 'BlockCypher balance'],
  },
  {
    slug: 'pos',
    kicker: 'POS Terminal',
    title: 'Turn any sale into a DOGE payment.',
    copy: 'Enter a USD price, show the QR, save the local order, then confirm the txid before fulfillment.',
    proof: 'A cashier can run the whole flow from one page.',
    accent: gold,
    highlight: {x: 98, y: 360, w: 510, h: 300, label: 'price, QR, save order'},
    stats: ['USD to DOGE', 'Local orders', 'Txid confirm'],
  },
  {
    slug: 'tools',
    kicker: 'Tools',
    title: 'Copy the pieces a website needs.',
    copy: 'Build payment routes, self-contained Dogecoin Accepted badges, Donate DOGE buttons, and quick transaction checks.',
    proof: 'No remote badge image required. The copied snippets stand alone.',
    accent: purple,
    highlight: {x: 48, y: 300, w: 1260, h: 430, label: 'QR generator + snippets'},
    stats: ['QR builder', 'Donate modal', 'Self-contained snippets'],
  },
  {
    slug: 'statistics',
    kicker: 'Statistics',
    title: 'Give merchants live market context.',
    copy: 'Show live DOGE-USD pricing, moving averages, trade flow, current market cap, and the $1 scenario.',
    proof: 'Market data is context, not investment advice.',
    accent: rose,
    highlight: {x: 88, y: 178, w: 1198, h: 585, label: 'live price, chart, flow'},
    stats: ['Live Coinbase', 'Market cap', 'Moving averages'],
  },
  {
    slug: 'playbook',
    kicker: 'Playbook',
    title: 'Choose a small adoption lane.',
    copy: 'Restaurants, creators, events, service desks, and nonprofits get practical launch kits instead of vague crypto hype.',
    proof: 'Pick one market, one offer, one confirmation rule.',
    accent: deepTeal,
    highlight: {x: 68, y: 180, w: 1210, h: 555, label: 'market-ready starter kits'},
    stats: ['Business lanes', 'Reusable files', 'Guardrails'],
  },
  {
    slug: 'faq',
    kicker: 'FAQ',
    title: 'Answer the questions that slow adoption.',
    copy: 'Custody, confirmations, taxes, donations, wallet support, hosted checkout, and employee training are covered plainly.',
    proof: 'Short answers help a business decide its next step.',
    accent: gold,
    highlight: {x: 92, y: 206, w: 1184, h: 632, label: 'merchant FAQ'},
    stats: ['Security basics', 'Tax records', 'Source links'],
  },
  {
    slug: 'technical',
    kicker: 'Technical',
    title: 'Integrate only when you need to.',
    copy: 'Payment URI format, QR endpoints, reusable data files, exchange notes, and a Python webhook demo are ready.',
    proof: 'Start simple, then wire up APIs or webhooks later.',
    accent: teal,
    highlight: {x: 72, y: 196, w: 1188, h: 584, label: 'protocols + integration path'},
    stats: ['DOGE URI', 'QR endpoint', 'Webhook demo'],
  },
];

const workflow = [
  {label: 'Set wallet', detail: 'Merchant controls the receiving address'},
  {label: 'Create QR', detail: 'The buyer scans a normal dogecoin URI'},
  {label: 'Confirm txid', detail: 'Check the blockchain before fulfillment'},
  {label: 'Keep records', detail: 'Export orders and reusable proof files'},
];

const ease = (frame: number, damping = 18, stiffness = 105) =>
  spring({
    frame: Math.max(0, frame),
    fps,
    config: {damping, stiffness},
  });

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const fade = (frame: number, from: number, duration = 18) =>
  interpolate(frame, [from, from + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const slide = (frame: number, from: number, distance = 42) =>
  interpolate(fade(frame, from, 20), [0, 1], [distance, 0]);

const Background = ({dark = false}: {dark?: boolean}) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 1440], [0, 70], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        background: dark
          ? 'radial-gradient(circle at 78% 16%, rgba(244,189,42,0.28), transparent 34%), linear-gradient(135deg, #101414 0%, #17211f 54%, #40340b 100%)'
          : 'radial-gradient(circle at 76% 16%, rgba(244,189,42,0.24), transparent 32%), linear-gradient(135deg, #fbfcf7 0%, #eef7ee 56%, #fff5d7 100%)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${drift}px, ${drift * 0.4}px)`,
          backgroundImage: dark
            ? 'linear-gradient(rgba(244,189,42,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(244,189,42,0.06) 1px, transparent 1px)'
            : 'linear-gradient(rgba(15,143,120,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(15,143,120,0.055) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          opacity: 0.78,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: -220,
          bottom: -260,
          width: 820,
          height: 820,
          borderRadius: '50%',
          border: `2px solid ${dark ? 'rgba(244,189,42,0.28)' : 'rgba(244,189,42,0.36)'}`,
          background: 'radial-gradient(circle, rgba(244,189,42,0.16), rgba(244,189,42,0))',
        }}
      />
    </AbsoluteFill>
  );
};

const LogoLockup = ({light = false, compact = false}: {light?: boolean; compact?: boolean}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: compact ? 14 : 18}}>
    <Img
      src={dogeLogo}
      style={{
        width: compact ? 54 : 78,
        height: compact ? 54 : 78,
        borderRadius: '50%',
        boxShadow: light ? '0 16px 36px rgba(0,0,0,0.28)' : '0 14px 28px rgba(23,23,21,0.16)',
      }}
    />
    <div>
      <div style={{fontSize: compact ? 28 : 40, fontWeight: 950, color: light ? '#fff8df' : ink}}>
        DOGE Commerce Kit
      </div>
      {!compact && (
        <div style={{fontSize: 22, marginTop: 4, color: light ? '#e9dfb2' : '#4a5a56'}}>
          Dogecoin checkout tools for real commerce
        </div>
      )}
    </div>
  </div>
);

const BrowserChrome = ({
  children,
  width,
  accent,
  title = 'localhost:42069',
  style,
}: {
  children: React.ReactNode;
  width: number;
  accent: string;
  title?: string;
  style?: React.CSSProperties;
}) => {
  const ratio = imageHeight / imageWidth;
  return (
    <div
      style={{
        width,
        borderRadius: 24,
        overflow: 'hidden',
        background: paper,
        border: '1px solid rgba(23,23,21,0.16)',
        boxShadow: '0 34px 90px rgba(23,23,21,0.24)',
        ...style,
      }}
    >
      <div
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 18px',
          background: 'rgba(255,255,255,0.92)',
          borderBottom: '1px solid rgba(23,23,21,0.10)',
        }}
      >
        {[rose, gold, teal].map((color) => (
          <span key={color} style={{width: 14, height: 14, borderRadius: '50%', background: color}} />
        ))}
        <div
          style={{
            marginLeft: 12,
            flex: 1,
            height: 28,
            borderRadius: 999,
            background: '#eef4ef',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 16,
            color: '#53615d',
            fontSize: 16,
            fontWeight: 800,
          }}
        >
          {title}
        </div>
        <div style={{width: 78, height: 8, borderRadius: 999, background: accent}} />
      </div>
      <div style={{position: 'relative', width, height: width * ratio, overflow: 'hidden'}}>{children}</div>
    </div>
  );
};

const AppScreenshot = ({
  slug,
  accent,
  highlight,
  width,
  progress,
  panY = 0,
}: {
  slug: string;
  accent: string;
  highlight?: Highlight;
  width: number;
  progress: number;
  panY?: number;
}) => {
  const scale = width / imageWidth;
  const h = imageHeight * scale;
  return (
    <BrowserChrome width={width} accent={accent}>
      <Img
        src={pageImage(slug)}
        style={{
          position: 'absolute',
          left: 0,
          top: panY,
          width,
          height: h,
          display: 'block',
          objectFit: 'cover',
          filter: 'saturate(1.02) contrast(1.02)',
        }}
      />
      {highlight && (
        <>
          <div
            style={{
              position: 'absolute',
              left: highlight.x * scale,
              top: highlight.y * scale + panY,
              width: highlight.w * scale,
              height: highlight.h * scale,
              borderRadius: 18,
              border: `5px solid ${accent}`,
              boxShadow: `0 0 0 999px rgba(11,17,16,${interpolate(progress, [0, 1], [0, 0.34])}), 0 0 34px ${accent}`,
              opacity: progress,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: highlight.x * scale + 22,
              top: highlight.y * scale + panY - 24,
              padding: '12px 18px',
              borderRadius: 999,
              background: accent,
              color: accent === gold ? ink : '#fff',
              fontSize: 21,
              fontWeight: 950,
              opacity: progress,
              transform: `translateY(${(1 - progress) * 18}px)`,
            }}
          >
            {highlight.label}
          </div>
        </>
      )}
    </BrowserChrome>
  );
};

const MetricPill = ({label, value, accent, delay}: {label: string; value: string; accent: string; delay: number}) => {
  const frame = useCurrentFrame();
  const enter = ease(frame - delay);
  return (
    <div
      style={{
        padding: '18px 20px',
        borderRadius: 18,
        background: 'rgba(255,255,255,0.9)',
        border: '1px solid rgba(23,23,21,0.12)',
        boxShadow: '0 16px 34px rgba(23,23,21,0.10)',
        transform: `translateY(${(1 - enter) * 26}px)`,
        opacity: enter,
      }}
    >
      <div style={{fontSize: 16, fontWeight: 950, color: '#5b6662', textTransform: 'uppercase'}}>{label}</div>
      <div style={{fontSize: 27, fontWeight: 980, color: ink, marginTop: 7}}>{value}</div>
      <div style={{height: 5, borderRadius: 999, marginTop: 12, background: accent, width: `${interpolate(enter, [0, 1], [12, 100])}%`}} />
    </div>
  );
};

const Cursor = ({x, y, accent}: {x: number; y: number; accent: string}) => {
  const frame = useCurrentFrame();
  const pulse = interpolate(Math.sin(frame / 5), [-1, 1], [0.74, 1]);
  return (
    <div style={{position: 'absolute', left: x, top: y, transform: `scale(${pulse})`, filter: 'drop-shadow(0 12px 18px rgba(23,23,21,0.20))'}}>
      <svg width="58" height="58" viewBox="0 0 58 58">
        <path d="M11 6l36 28-18 3-9 15-9-46z" fill="#fff" stroke={accent} strokeWidth="4" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const FlowLine = ({active}: {active: number}) => (
  <div style={{position: 'absolute', left: 230, right: 230, top: 608, height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.18)', overflow: 'hidden'}}>
    <div
      style={{
        height: '100%',
        width: `${active * 100}%`,
        borderRadius: 999,
        background: `linear-gradient(90deg, ${teal}, ${gold})`,
      }}
    />
  </div>
);

const OpeningScene = () => {
  const frame = useCurrentFrame();
  const enter = ease(frame);
  const coinSpin = interpolate(frame, [0, 180], [-10, 12], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill>
      <Background dark />
      <div style={{position: 'absolute', left: 104, top: 86, opacity: fade(frame, 0, 18)}}>
        <LogoLockup light />
      </div>
      <div style={{position: 'absolute', left: 112, top: 264, width: 860}}>
        <div
          style={{
            fontSize: 112,
            lineHeight: 0.88,
            fontWeight: 980,
            color: '#fffaf0',
            transform: `translateY(${(1 - enter) * 54}px)`,
            opacity: enter,
          }}
        >
          Accept DOGE without turning checkout into a science project.
        </div>
        <div style={{fontSize: 34, lineHeight: 1.26, color: '#e8e1c6', marginTop: 34, opacity: fade(frame, 16, 24)}}>
          A practical commerce kit for wallets, QR payments, transaction checks, snippets, market context, and adoption playbooks.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 112,
          top: 194,
          width: 620,
          height: 620,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(244,189,42,0.28), rgba(244,189,42,0.02) 58%, transparent 70%)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Img
          src={dogeLogo}
          style={{
            width: 450,
            height: 450,
            borderRadius: '50%',
            transform: `rotate(${coinSpin}deg) scale(${interpolate(enter, [0, 1], [0.82, 1])})`,
            boxShadow: '0 40px 100px rgba(0,0,0,0.30)',
            opacity: fade(frame, 8, 22),
          }}
        />
      </div>
      <div style={{position: 'absolute', left: 112, bottom: 100, display: 'flex', gap: 18, opacity: fade(frame, 38, 22)}}>
        {['Set wallet', 'Show QR', 'Confirm txid', 'Export records'].map((item, index) => (
          <div
            key={item}
            style={{
              padding: '18px 24px',
              borderRadius: 999,
              background: index === 1 ? gold : 'rgba(255,255,255,0.10)',
              color: index === 1 ? ink : '#fffaf0',
              border: '1px solid rgba(255,255,255,0.20)',
              fontSize: 25,
              fontWeight: 950,
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const WorkflowScene = () => {
  const frame = useCurrentFrame();
  const active = clamp(interpolate(frame, [12, 138], [0, 1]));
  return (
    <AbsoluteFill>
      <Background />
      <div style={{position: 'absolute', left: 92, top: 70}}>
        <LogoLockup compact />
      </div>
      <div style={{position: 'absolute', left: 116, top: 194, width: 840}}>
        <div style={{fontSize: 82, lineHeight: 0.96, fontWeight: 980, color: ink}}>
          The core checkout flow is four moves.
        </div>
        <div style={{fontSize: 31, color: '#365b58', marginTop: 24}}>
          Everything else is optional until a merchant is ready to grow.
        </div>
      </div>
      <FlowLine active={active} />
      <div style={{position: 'absolute', left: 150, right: 150, top: 520, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 26}}>
        {workflow.map((step, index) => {
          const enter = ease(frame - index * 14);
          const glow = active >= (index + 0.5) / workflow.length;
          return (
            <div
              key={step.label}
              style={{
                minHeight: 270,
                padding: 26,
                borderRadius: 22,
                background: glow ? `linear-gradient(135deg, ${gold}, #fff6cf)` : '#fff',
                border: `2px solid ${glow ? gold : 'rgba(23,23,21,0.12)'}`,
                boxShadow: glow ? '0 26px 60px rgba(244,189,42,0.24)' : '0 20px 42px rgba(23,23,21,0.09)',
                transform: `translateY(${(1 - enter) * 44}px)`,
                opacity: enter,
              }}
            >
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  background: glow ? ink : deepTeal,
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 25,
                  fontWeight: 980,
                  marginBottom: 28,
                }}
              >
                {index + 1}
              </div>
              <div style={{fontSize: 32, fontWeight: 980, color: ink}}>{step.label}</div>
              <div style={{fontSize: 22, lineHeight: 1.28, color: '#4a5b56', marginTop: 13}}>{step.detail}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const FeatureSceneView = ({feature, index}: {feature: FeatureScene; index: number}) => {
  const frame = useCurrentFrame();
  const shot = ease(frame - 8);
  const highlightProgress = fade(frame, 28, 24);
  const phoneShift = interpolate(frame, [0, 116], [0, -18], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill>
      <Background />
      <div style={{position: 'absolute', left: 82, top: 66}}>
        <LogoLockup compact />
      </div>
      <div style={{position: 'absolute', right: 88, top: 72, fontSize: 24, fontWeight: 950, color: '#63716c'}}>
        {String(index + 1).padStart(2, '0')} / {String(features.length).padStart(2, '0')}
      </div>
      <div style={{position: 'absolute', left: 96, top: 178, width: 605}}>
        <div style={{fontSize: 22, letterSpacing: 5, textTransform: 'uppercase', fontWeight: 950, color: feature.accent}}>
          {feature.kicker}
        </div>
        <div
          style={{
            fontSize: 67,
            lineHeight: 0.97,
            fontWeight: 980,
            color: ink,
            marginTop: 18,
            transform: `translateY(${slide(frame, 0, 36)}px)`,
            opacity: fade(frame, 0, 18),
          }}
        >
          {feature.title}
        </div>
        <div style={{fontSize: 29, lineHeight: 1.3, color: '#3d514d', marginTop: 26, opacity: fade(frame, 12, 20)}}>
          {feature.copy}
        </div>
        <div
          style={{
            marginTop: 36,
            padding: '20px 22px',
            borderRadius: 18,
            background: '#fff',
            border: `2px solid ${feature.accent}`,
            fontSize: 23,
            lineHeight: 1.22,
            color: ink,
            fontWeight: 900,
            boxShadow: '0 18px 40px rgba(23,23,21,0.10)',
            opacity: fade(frame, 28, 18),
          }}
        >
          {feature.proof}
        </div>
        <div style={{display: 'grid', gap: 12, marginTop: 24}}>
          {feature.stats.map((stat, statIndex) => (
            <MetricPill key={stat} label={`Includes ${statIndex + 1}`} value={stat} accent={feature.accent} delay={38 + statIndex * 6} />
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 90,
          top: 156 + phoneShift,
          transform: `translateY(${(1 - shot) * 52}px) scale(${interpolate(shot, [0, 1], [0.97, 1])})`,
          opacity: shot,
        }}
      >
        <AppScreenshot slug={feature.slug} accent={feature.accent} highlight={feature.highlight} width={1080} progress={highlightProgress} />
      </div>
      <Cursor x={1390} y={800 + phoneShift} accent={feature.accent} />
    </AbsoluteFill>
  );
};

const ProofScene = () => {
  const frame = useCurrentFrame();
  const cards = [
    {slug: 'pos', label: 'Checkout proof', color: gold},
    {slug: 'statistics', label: 'Live market context', color: rose},
    {slug: 'technical', label: 'Integration handoff', color: teal},
  ];
  return (
    <AbsoluteFill>
      <Background dark />
      <div style={{position: 'absolute', left: 96, top: 72}}>
        <LogoLockup light compact />
      </div>
      <div style={{position: 'absolute', left: 112, top: 190, width: 930}}>
        <div style={{fontSize: 88, lineHeight: 0.94, fontWeight: 980, color: '#fffaf0'}}>
          Built for the first sale and the system after it.
        </div>
        <div style={{fontSize: 31, lineHeight: 1.28, marginTop: 26, color: '#e8e1c6'}}>
          The site starts with a simple QR payment, then gives operators the proof, references, and integration paths they need.
        </div>
      </div>
      <div style={{position: 'absolute', left: 112, right: 112, bottom: 94, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28}}>
        {cards.map((card, index) => {
          const enter = ease(frame - index * 12);
          return (
            <div
              key={card.slug}
              style={{
                borderRadius: 22,
                overflow: 'hidden',
                border: `2px solid ${card.color}`,
                background: '#fff',
                boxShadow: '0 28px 70px rgba(0,0,0,0.24)',
                transform: `translateY(${(1 - enter) * 46}px) rotate(${interpolate(enter, [0, 1], [index === 1 ? 0 : index === 0 ? -2 : 2, 0])}deg)`,
                opacity: enter,
              }}
            >
              <Img src={pageImage(card.slug)} style={{width: '100%', height: 254, objectFit: 'cover', objectPosition: 'top', display: 'block'}} />
              <div style={{padding: 22, display: 'flex', alignItems: 'center', gap: 14}}>
                <span style={{width: 16, height: 16, borderRadius: '50%', background: card.color}} />
                <strong style={{fontSize: 28, color: ink}}>{card.label}</strong>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const OutroScene = () => {
  const frame = useCurrentFrame();
  const enter = ease(frame);
  return (
    <AbsoluteFill>
      <Background />
      <div style={{position: 'absolute', left: 118, top: 92}}>
        <LogoLockup />
      </div>
      <div style={{position: 'absolute', left: 126, top: 284, width: 980}}>
        <div
          style={{
            fontSize: 104,
            lineHeight: 0.9,
            fontWeight: 980,
            color: ink,
            opacity: enter,
            transform: `translateY(${(1 - enter) * 48}px)`,
          }}
        >
          Make Dogecoin useful where people already buy.
        </div>
        <div style={{fontSize: 34, lineHeight: 1.28, color: '#365b58', marginTop: 34, opacity: fade(frame, 18, 22)}}>
          Open the POS Terminal, show a QR code, confirm the transaction, and give one more business a reason to try DOGE in real life.
        </div>
      </div>
      <div style={{position: 'absolute', left: 126, bottom: 130, display: 'flex', gap: 24, opacity: fade(frame, 34, 20)}}>
        {[
          ['Open POS Terminal', gold],
          ['Try Donate DOGE', '#fff'],
          ['Get site snippets', '#fff'],
        ].map(([label, color], index) => (
          <div
            key={label}
            style={{
              padding: '23px 31px',
              borderRadius: 16,
              background: color,
              color: ink,
              border: '1px solid rgba(23,23,21,0.14)',
              boxShadow: '0 18px 34px rgba(23,23,21,0.12)',
              fontSize: 28,
              fontWeight: 950,
              transform: `translateY(${slide(frame, 34 + index * 5, 20)}px)`,
            }}
          >
            {label}
          </div>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 120,
          bottom: 118,
          width: 420,
          textAlign: 'right',
          color: teal,
          fontSize: 31,
          lineHeight: 1.1,
          fontWeight: 950,
          opacity: fade(frame, 44, 20),
        }}
      >
        MIT licensed.
        <br />
        Do Only Good Everyday.
      </div>
    </AbsoluteFill>
  );
};

export const DogeCommerceLaunch = () => (
  <AbsoluteFill style={{fontFamily: 'Inter, Arial, Helvetica, sans-serif'}}>
    <Sequence from={0} durationInFrames={180}>
      <OpeningScene />
    </Sequence>
    <Sequence from={180} durationInFrames={150}>
      <WorkflowScene />
    </Sequence>
    {features.map((feature, index) => (
      <Sequence key={feature.slug} from={330 + index * 120} durationInFrames={126}>
        <FeatureSceneView feature={feature} index={index} />
      </Sequence>
    ))}
    <Sequence from={1170} durationInFrames={120}>
      <ProofScene />
    </Sequence>
    <Sequence from={1290} durationInFrames={150}>
      <OutroScene />
    </Sequence>
  </AbsoluteFill>
);
