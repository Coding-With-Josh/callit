/**
 * apple-touch-icon (180x180 PNG). Generated with the framework's bundled font —
 * no local asset is read, so icon generation cannot fail on a missing file.
 */
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#2D1C00',
        }}
      >
        <div style={{ display: 'flex', fontSize: 132, fontWeight: 700, color: '#FFF2DD' }}>
          c
        </div>
      </div>
    ),
    size,
  );
}
