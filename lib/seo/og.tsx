/**
 * seo/og — the shared Open Graph / Twitter image renderer.
 *
 * Owns: the one OG layout used by the root and per-market image routes, so the
 * brand treatment cannot drift between them. Returns a `next/og` ImageResponse
 * (1200x630 PNG) rendered with the framework's bundled default font — no local
 * TTF is read, so image generation cannot fail on a font parse.
 * Must not import: any UI module.
 */
import { ImageResponse } from 'next/og';
import { SITE } from './site';

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

const INK = '#2D1C00';
const CREAM = '#FFF2DD';

export interface OgArgs {
  /** Small label above the title (e.g. the market category). */
  readonly eyebrow?: string;
  /** The headline. Clamped so a long market title still fits. */
  readonly title: string;
  /** Supporting line under the title. */
  readonly subtitle?: string;
  /** Odds, already formatted as percent strings (e.g. "62"). */
  readonly yes?: string | null;
  readonly no?: string | null;
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export function ogImage({ eyebrow, title, subtitle, yes, no }: OgArgs) {
  const headline = clamp(title, 120);
  const fontSize = headline.length > 72 ? 52 : headline.length > 44 ? 62 : 74;
  const host = SITE.url.replace(/^https?:\/\//, '');
  const showOdds = Boolean(yes || no);

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: CREAM,
          color: INK,
          padding: '64px',
          justifyContent: 'space-between',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em' }}
          >
            callit
          </div>
          {eyebrow ? (
            <div
              style={{
                display: 'flex',
                fontSize: 22,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: 'rgba(45,28,0,0.55)',
              }}
            >
              {eyebrow}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize,
              fontWeight: 700,
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
            }}
          >
            {headline}
          </div>
          {subtitle ? (
            <div
              style={{
                display: 'flex',
                marginTop: 20,
                fontSize: 30,
                color: 'rgba(45,28,0,0.7)',
              }}
            >
              {clamp(subtitle, 150)}
            </div>
          ) : null}
          {showOdds ? (
            <div style={{ display: 'flex', gap: 20, marginTop: 36 }}>
              {yes ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 12,
                    background: INK,
                    color: CREAM,
                    borderRadius: 999,
                    padding: '16px 32px',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      fontSize: 24,
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                    }}
                  >
                    YES
                  </span>
                  <span
                    style={{ display: 'flex', fontSize: 44, fontWeight: 700 }}
                  >
                    {yes}%
                  </span>
                </div>
              ) : null}
              {no ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 12,
                    background: 'rgba(45,28,0,0.12)',
                    color: INK,
                    borderRadius: 999,
                    padding: '16px 32px',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      fontSize: 24,
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                    }}
                  >
                    NO
                  </span>
                  <span
                    style={{ display: 'flex', fontSize: 44, fontWeight: 700 }}
                  >
                    {no}%
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '2px solid rgba(45,28,0,0.15)',
            paddingTop: 24,
          }}
        >
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 600 }}>
            Powered by Panta
          </div>
          <div
            style={{ display: 'flex', fontSize: 24, color: 'rgba(45,28,0,0.6)' }}
          >
            {host}
          </div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
