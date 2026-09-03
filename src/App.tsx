import React, { useState, useEffect, useRef } from 'react';

interface Book {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
}

interface MatchResult {
  matchedWishlistItem: string;
  detectedSpineTitle: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
}

export default function App() {
  // API key pulled directly from environment variable
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';

  // App State & Tabs
  const [activeTab, setActiveTab] = useState<'scan' | 'wishlist' | 'library'>('scan');
  const [wishlist, setWishlist] = useState<Book[]>([]);
  const [library, setLibrary] = useState<Book[]>([]);

  // Scanning & Vision State
  const [scanMode, setScanMode] = useState<'wishlist_shelf' | 'library_shelf' | 'isbn'>('wishlist_shelf');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [detectedBooks, setDetectedBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Manual Entry Form State
  const [manualTitle, setManualTitle] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load saved lists from LocalStorage on mount
  useEffect(() => {
    const savedWishlist = localStorage.getItem('shelfscan_wishlist');
    const savedLibrary = localStorage.getItem('shelfscan_library');

    if (savedWishlist) setWishlist(JSON.parse(savedWishlist));
    else setWishlist([
      { id: '1', title: 'Dune', author: 'Frank Herbert' },
      { id: '2', title: 'The Hobbit', author: 'J.R.R. Tolkien' },
      { id: '3', title: 'Neuromancer', author: 'William Gibson' }
    ]);

    if (savedLibrary) setLibrary(JSON.parse(savedLibrary));
  }, []);

  // Sync state changes to LocalStorage
  useEffect(() => {
    localStorage.setItem('shelfscan_wishlist', JSON.stringify(wishlist));
  }, [wishlist]);

  useEffect(() => {
    localStorage.setItem('shelfscan_library', JSON.stringify(library));
  }, [library]);

  // Image Upload Handler
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setMatches([]);
      setDetectedBooks([]);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  // Add Book Manually
  const handleAddManual = (target: 'wishlist' | 'library') => {
    if (!manualTitle.trim()) return;
    const newBook: Book = {
      id: Date.now().toString(),
      title: manualTitle.trim(),
      author: manualAuthor.trim() || undefined,
    };

    if (target === 'wishlist') {
      setWishlist([...wishlist, newBook]);
    } else {
      setLibrary([...library, newBook]);
    }

    setManualTitle('');
    setManualAuthor('');
  };

  // Main Gemini Vision Dispatcher
  const handleScan = async () => {
    if (!apiKey) {
      setError('VITE_GEMINI_API_KEY is not set in your .env file.');
      return;
    }
    if (!imageSrc) {
      setError('Please take or upload an image first.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const base64Data = imageSrc.split(',')[1];

      if (scanMode === 'wishlist_shelf') {
        // --- MODE 1: Match Wishlist on Shelf ---
        const wishlistTitles = wishlist.map((b) => b.title);
        const prompt = `
          Analyze this image of a bookshelf.
          Target Wishlist: ${JSON.stringify(wishlistTitles)}.
          1. Scan visible titles on book spines.
          2. Match against wishlist.
          3. For matches, return box_2d [ymin, xmin, ymax, xmax] 0-1000.
        `;

        const schema = {
          type: 'OBJECT',
          properties: {
            matches: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  matchedWishlistItem: { type: 'STRING' },
                  detectedSpineTitle: { type: 'STRING' },
                  box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
                },
                required: ['matchedWishlistItem', 'detectedSpineTitle', 'box_2d'],
              },
            },
          },
          required: ['matches'],
        };

        const res = await callGeminiAPI(prompt, base64Data, schema);
        setMatches(res.matches || []);

      } else if (scanMode === 'library_shelf') {
        // --- MODE 2: Bulk Shelf Scan to Add to Owned Library ---
        const prompt = `
          Analyze this image of a home bookshelf.
          Extract all visible book titles and authors from book spines.
        `;

        const schema = {
          type: 'OBJECT',
          properties: {
            books: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  author: { type: 'STRING' },
                },
                required: ['title'],
              },
            },
          },
          required: ['books'],
        };

        const res = await callGeminiAPI(prompt, base64Data, schema);
        const parsedBooks: Book[] = (res.books || []).map((b: any) => ({
          id: Math.random().toString(),
          title: b.title,
          author: b.author,
        }));
        setDetectedBooks(parsedBooks);

      } else if (scanMode === 'isbn') {
        // --- MODE 3: Single Book ISBN / Barcode Scan ---
        const prompt = `
          Analyze this image of the back or inside cover of a book.
          Identify the ISBN-10 or ISBN-13 barcode/number, title, and author if visible.
        `;

        const schema = {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            author: { type: 'STRING' },
            isbn: { type: 'STRING' },
          },
          required: ['title'],
        };

        const res = await callGeminiAPI(prompt, base64Data, schema);
        if (res.title) {
          setDetectedBooks([{
            id: Date.now().toString(),
            title: res.title,
            author: res.author,
            isbn: res.isbn,
          }]);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Scanning failed.');
    } finally {
      setLoading(false);
    }
  };

  // Helper API Fetch Function
  const callGeminiAPI = async (prompt: string, base64Data: string, schema: any) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        }),
      }
    );

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'API error');
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(text || '{}');
  };

  // Bulk add scanned books to library
  const handleImportDetectedToLibrary = () => {
    setLibrary([...library, ...detectedBooks]);
    setDetectedBooks([]);
    setImageSrc(null);
    setActiveTab('library');
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Top Header */}
        <header style={styles.header}>
          <h1 style={styles.title}>📚 ShelfScan AI</h1>
          <nav style={styles.nav}>
            <button
              onClick={() => setActiveTab('scan')}
              style={activeTab === 'scan' ? styles.activeNavBtn : styles.navBtn}
            >
              Scan
            </button>
            <button
              onClick={() => setActiveTab('wishlist')}
              style={activeTab === 'wishlist' ? styles.activeNavBtn : styles.navBtn}
            >
              Wishlist ({wishlist.length})
            </button>
            <button
              onClick={() => setActiveTab('library')}
              style={activeTab === 'library' ? styles.activeNavBtn : styles.navBtn}
            >
              Library ({library.length})
            </button>
          </nav>
        </header>

        {/* --- TAB 1: SCANNER --- */}
        {activeTab === 'scan' && (
          <div style={styles.section}>
            <div style={styles.modeSelector}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="scanMode"
                  checked={scanMode === 'wishlist_shelf'}
                  onChange={() => setScanMode('wishlist_shelf')}
                />
                Match Shelf to Wishlist
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="scanMode"
                  checked={scanMode === 'library_shelf'}
                  onChange={() => setScanMode('library_shelf')}
                />
                Scan Shelf to Library
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="scanMode"
                  checked={scanMode === 'isbn'}
                  onChange={() => setScanMode('isbn')}
                />
                Scan Barcode / ISBN
              </label>
            </div>

            <div style={styles.buttonRow}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                ref={fileInputRef}
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={styles.secondaryBtn}
              >
                {imageSrc ? 'Retake / Change Photo' : '📷 Take Photo'}
              </button>

              {imageSrc && (
                <button
                  onClick={handleScan}
                  disabled={loading}
                  style={{ ...styles.primaryBtn, opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Scanning with AI...' : 'Run Scan'}
                </button>
              )}
            </div>

            {error && <div style={styles.errorBox}>{error}</div>}

            {/* Viewport Overlay */}
            {imageSrc && (
              <div style={styles.viewerContainer}>
                <div style={styles.imageWrapper}>
                  <img src={imageSrc} alt="Scan target" style={styles.image} />

                  {/* Bounding box highlights for wishlist mode */}
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
                        <span style={styles.badge}>{match.matchedWishlistItem}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Detected Books List (For Shelf Import or ISBN mode) */}
                {detectedBooks.length > 0 && (
                  <div style={styles.resultsBox}>
                    <h3 style={{ color: '#10b981', margin: '0 0 8px 0' }}>
                      Detected {detectedBooks.length} Book(s):
                    </h3>
                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px' }}>
                      {detectedBooks.map((b) => (
                        <li key={b.id}>
                          <strong>{b.title}</strong> {b.author && `by ${b.author}`} {b.isbn && `(ISBN: ${b.isbn})`}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={handleImportDetectedToLibrary}
                      style={{ ...styles.primaryBtn, marginTop: '12px', width: '100%' }}
                    >
                      Import All to Owned Library
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* --- TAB 2: WISHLIST --- */}
        {activeTab === 'wishlist' && (
          <div style={styles.section}>
            <h2>My Wishlist</h2>
            <div style={styles.addForm}>
              <input
                placeholder="Book Title"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                style={styles.input}
              />
              <input
                placeholder="Author (Optional)"
                value={manualAuthor}
                onChange={(e) => setManualAuthor(e.target.value)}
                style={styles.input}
              />
              <button onClick={() => handleAddManual('wishlist')} style={styles.primaryBtn}>
                Add to Wishlist
              </button>
            </div>

            <ul style={styles.list}>
              {wishlist.map((b) => (
                <li key={b.id} style={styles.listItem}>
                  <div>
                    <strong>{b.title}</strong>
                    {b.author && <span style={styles.subtext}> by {b.author}</span>}
                  </div>
                  <button
                    onClick={() => setWishlist(wishlist.filter((item) => item.id !== b.id))}
                    style={styles.deleteBtn}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* --- TAB 3: OWNED LIBRARY --- */}
        {activeTab === 'library' && (
          <div style={styles.section}>
            <h2>My Owned Library</h2>
            <div style={styles.addForm}>
              <input
                placeholder="Book Title"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                style={styles.input}
              />
              <input
                placeholder="Author (Optional)"
                value={manualAuthor}
                onChange={(e) => setManualAuthor(e.target.value)}
                style={styles.input}
              />
              <button onClick={() => handleAddManual('library')} style={styles.primaryBtn}>
                Add to Library
              </button>
            </div>

            <ul style={styles.list}>
              {library.length === 0 ? (
                <p style={styles.subtext}>No books in your library yet. Add manually or scan your bookshelf!</p>
              ) : (
                library.map((b) => (
                  <li key={b.id} style={styles.listItem}>
                    <div>
                      <strong>{b.title}</strong>
                      {b.author && <span style={styles.subtext}> by {b.author}</span>}
                      {b.isbn && <div style={styles.subtext}>ISBN: {b.isbn}</div>}
                    </div>
                    <button
                      onClick={() => setLibrary(library.filter((item) => item.id !== b.id))}
                      style={styles.deleteBtn}
                    >
                      ✕
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline CSS Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '16px',
    display: 'flex',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: '600px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #334155',
    paddingBottom: '12px',
  },
  title: { margin: 0, color: '#10b981', fontSize: '20px' },
  nav: { display: 'flex', gap: '8px' },
  navBtn: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#1e293b',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '12px',
  },
  activeNavBtn: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#10b981',
    color: '#0f172a',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '12px',
  },
  section: { display: 'flex', flexDirection: 'column', gap: '12px' },
  modeSelector: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    backgroundColor: '#1e293b',
    padding: '12px',
    borderRadius: '8px',
  },
  radioLabel: { fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' },
  buttonRow: { display: 'flex', gap: '8px' },
  primaryBtn: {
    padding: '10px 16px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#10b981',
    color: '#0f172a',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '13px',
  },
  secondaryBtn: {
    padding: '10px 16px',
    borderRadius: '6px',
    border: '1px solid #334155',
    backgroundColor: '#334155',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
  },
  errorBox: {
    padding: '10px',
    borderRadius: '6px',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    border: '1px solid #ef4444',
    color: '#fca5a5',
    fontSize: '13px',
  },
  viewerContainer: { display: 'flex', flexDirection: 'column', gap: '12px' },
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
  addForm: { display: 'flex', flexDirection: 'column', gap: '8px' },
  input: {
    padding: '10px',
    borderRadius: '6px',
    border: '1px solid #334155',
    backgroundColor: '#1e293b',
    color: '#fff',
    fontSize: '14px',
  },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' },
  listItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: '12px',
    borderRadius: '6px',
    border: '1px solid #334155',
  },
  subtext: { color: '#94a3b8', fontSize: '12px' },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#ef4444',
    fontSize: '16px',
    cursor: 'pointer',
  },
};
