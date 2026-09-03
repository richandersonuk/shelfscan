import React, { useState, useRef } from 'react';

interface MatchResult {
  matchedWishlistItem: string;
  detectedSpineTitle: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
}

export default function App() {
  const [apiKey, setApiKey] = useState<string>(
    import.meta.env.VITE_GEMINI_API_KEY || ''
  );
  const [wishlistInput, setWishlistInput] = useState<string>(
    'Dune, The Hobbit, Neuromancer, 1984, Foundation'
  );
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setMatches([]);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleScan = async () => {
    if (!apiKey) {
      setError('Please enter a Google Gen AI API Key.');
      return;
    }
    if (!imageSrc) {
      setError('Please upload a bookshelf image first.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const wishlistArray = wishlistInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const base64Data = imageSrc.split(',')[1];

      const responseSchema = {
        type: 'OBJECT',
        properties: {
          matches: {
            type: 'ARRAY',
            description: 'List of wishlist books found on the shelf.',
            items: {
              type: 'OBJECT',
              properties: {
                matchedWishlistItem: {
                  type: 'STRING',
                  description: 'Wishlist title matched.',
                },
                detectedSpineTitle: {
                  type: 'STRING',
                  description: 'Text read from spine.',
                },
                box_2d: {
                  type: 'ARRAY',
                  items: { type: 'INTEGER' },
                  description: '[ymin, xmin, ymax, xmax] coordinates 0-1000.',
                },
              },
              required: ['matchedWishlistItem', 'detectedSpineTitle', 'box_2d'],
            },
          },
        },
        required: ['matches'],
      };

      const prompt = `
        Analyze this image of a bookshelf.
        Wishlist: ${JSON.stringify(wishlistArray)}.
        
        Task:
        1. Read visible titles on book spines.
        2. Match them against the wishlist.
        3. For each match, return exact bounding box coordinates as [ymin, xmin, ymax, xmax] normalized 0 to 1000.
      `;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: responseSchema,
            },
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Gemini API call failed.');
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        setMatches(parsed.matches || []);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to scan image.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.heading}>📚 ShelfScan AI</h1>
        <p style={styles.subheading}>
          Upload a bookshelf photo to locate wishlist books.
        </p>

        {/* Inputs */}
        <div style={styles.inputGroup}>
          <label style={styles.label}>Gemini API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIzaSy..."
            style={styles.input}
          />
        </div>

        <div style={styles.inputGroup}>
          <label style={styles.label}>Wishlist (comma separated)</label>
          <input
            type="text"
            value={wishlistInput}
            onChange={(e) => setWishlistInput(e.target.value)}
            style={styles.input}
          />
        </div>

        {/* Actions */}
        <div style={styles.buttonRow}>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleImageUpload}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={styles.secondaryButton}
          >
            {imageSrc ? 'Change Image' : 'Upload Shelf Photo'}
          </button>

          {imageSrc && (
            <button
              onClick={handleScan}
              disabled={loading}
              style={{
                ...styles.primaryButton,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Scanning Shelf...' : 'Scan for Wishlist'}
            </button>
          )}
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}

        {/* Viewport Overlay */}
        {imageSrc && (
          <div style={styles.viewerContainer}>
            <div style={styles.imageWrapper}>
              <img src={imageSrc} alt="Shelf" style={styles.image} />

              {matches.map((match, idx) => {
                const [ymin, xmin, ymax, xmax] = match.box_2d;

                const boxStyle: React.CSSProperties = {
                  position: 'absolute',
                  top: `${ymin / 10}%`,
                  left: `${xmin / 10}%`,
                  height: `${(ymax - ymin) / 10}%`,
                  width: `${(xmax - xmin) / 10}%`,
                  border: '3px solid #10b981',
                  backgroundColor: 'rgba(16, 185, 129, 0.35)',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                };

                return (
                  <div key={idx} style={boxStyle}>
                    <span style={styles.badge}>
                      {match.matchedWishlistItem}
                    </span>
                  </div>
                );
              })}
            </div>

            {matches.length > 0 && (
              <div style={styles.resultsBox}>
                <h3
                  style={{
                    color: '#10b981',
                    margin: '0 0 8px 0',
                    fontSize: '14px',
                  }}
                >
                  Found {matches.length} Match(es):
                </h3>
                <ul
                  style={{ margin: 0, paddingLeft: '20px', fontSize: '13px' }}
                >
                  {matches.map((m, i) => (
                    <li key={i}>
                      <strong>{m.matchedWishlistItem}</strong> (Spine reads: "
                      {m.detectedSpineTitle}")
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '24px',
    display: 'flex',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: '700px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  heading: { margin: 0, color: '#10b981', fontSize: '24px' },
  subheading: { margin: 0, color: '#94a3b8', fontSize: '14px' },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '12px', color: '#94a3b8' },
  input: {
    padding: '10px',
    borderRadius: '6px',
    border: '1px solid #334155',
    backgroundColor: '#1e293b',
    color: '#fff',
    fontSize: '14px',
  },
  buttonRow: { display: 'flex', gap: '12px', marginTop: '8px' },
  primaryButton: {
    padding: '10px 20px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#10b981',
    color: '#0f172a',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '10px 20px',
    borderRadius: '6px',
    border: '1px solid #334155',
    backgroundColor: '#334155',
    color: '#fff',
    cursor: 'pointer',
  },
  errorBox: {
    padding: '10px',
    borderRadius: '6px',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    border: '1px solid #ef4444',
    color: '#fca5a5',
    fontSize: '13px',
  },
  viewerContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginTop: '12px',
  },
  imageWrapper: {
    position: 'relative',
    display: 'inline-block',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  image: { display: 'block', maxWidth: '100%', height: 'auto' },
  badge: {
    position: 'absolute',
    top: '-24px',
    left: '0',
    backgroundColor: '#10b981',
    color: '#0f172a',
    fontWeight: 'bold',
    fontSize: '11px',
    padding: '2px 6px',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
  },
  resultsBox: {
    backgroundColor: '#1e293b',
    padding: '12px',
    borderRadius: '6px',
    border: '1px solid #334155',
  },
};
