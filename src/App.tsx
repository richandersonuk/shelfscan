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

interface Suggestion {
  title: string;
  author: string;
}

export default function App() {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';

  // App State
  const [activeTab, setActiveTab] = useState<'scan' | 'wishlist' | 'library'>('scan');
  const [wishlist, setWishlist] = useState<Book[]>([]);
  const [library, setLibrary] = useState<Book[]>([]);

  // Scan Mode State: 'search_shelf' | 'add_wishlist' | 'add_library'
  const [scanMode, setScanMode] = useState<'search_shelf' | 'add_wishlist' | 'add_library'>('search_shelf');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [detectedBooks, setDetectedBooks] = useState<Book[]>([]);
  const [selectedBooks, setSelectedBooks] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Manual Form & Auto-complete State
  const [manualTitle, setManualTitle] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Dedicated File & Camera Inputs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // LocalStorage Persistence
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

  useEffect(() => {
    localStorage.setItem('shelfscan_wishlist', JSON.stringify(wishlist));
  }, [wishlist]);

  useEffect(() => {
    localStorage.setItem('shelfscan_library', JSON.stringify(library));
  }, [library]);

  // Open Library Auto-complete Debounce
  useEffect(() => {
    if (manualTitle.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(manualTitle)}&limit=5`);
        const data = await res.json();
        if (data.docs) {
          const results: Suggestion[] = data.docs.map((doc: any) => ({
            title: doc.title,
            author: doc.author_name ? doc.author_name[0] : 'Unknown Author',
          }));
          setSuggestions(results);
        }
      } catch (e) {
        console.error('Auto-complete error:', e);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [manualTitle]);

  const handleSelectSuggestion = (s: Suggestion) => {
    setManualTitle(s.title);
    setManualAuthor(s.author);
    setSuggestions([]);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setMatches([]);
      setDetectedBooks([]);
      setSelectedBooks({});
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const compressImage = (base64DataUrl: string, maxWidth = 1280): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64DataUrl;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);
        resolve(compressedDataUrl.split(',')[1]);
      };
    });
  };

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
    setSuggestions([]);
  };

  // Main Gemini Scan
  const handleScan = async () => {
    if (!apiKey) {
      setError('VITE_GEMINI_API_KEY is not set in environment variables.');
      return;
    }
    if (!imageSrc) {
      setError('Please select or capture an image first.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const compressedBase64 = await compressImage(imageSrc, 1280);

      if (scanMode === 'search_shelf') {
        const wishlistTitles = wishlist.map((b) => b.title);
        const prompt = `Match spines in image against wishlist: ${JSON.stringify(wishlistTitles)}. Return JSON matches with box_2d [ymin, xmin, ymax, xmax] 0-1000.`;

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

        const res = await callGeminiAPI(prompt, compressedBase64, schema);
        setMatches(res.matches || []);

      } else {
        // MODE: Add to Wishlist OR Add to Library (handles single cover, barcode/ISBN, bookshelf, or screenshot)
        const prompt = `
          Analyze this image to extract book information.
          It could be a book cover, book spine, rear cover with a barcode/ISBN, a full bookshelf, or a screenshot containing a list of books.
          Extract all visible book titles, authors, and ISBN numbers.
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
                  isbn: { type: 'STRING' },
                },
                required: ['title'],
              },
            },
          },
          required: ['books'],
        };

        const res = await callGeminiAPI(prompt, compressedBase64, schema);
        const parsedBooks: Book[] = (res.books || []).map((b: any) => ({
          id: Math.random().toString(),
          title: b.title,
          author: b.author,
          isbn: b.isbn,
        }));

        setDetectedBooks(parsedBooks);
        const initSelected: Record<string, boolean> = {};
        parsedBooks.forEach((b) => (initSelected[b.id] = true));
        setSelectedBooks(initSelected);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Scanning failed.');
    } finally {
      setLoading(false);
    }
  };

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

  const toggleSelectBook = (id: string) => {
    setSelectedBooks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleImportSelected = (target: 'wishlist' | 'library') => {
    const booksToAdd = detectedBooks.filter((b) => selectedBooks[b.id]);
    if (target === 'wishlist') {
      setWishlist([...wishlist, ...booksToAdd]);
      setActiveTab('wishlist');
    } else {
      setLibrary([...library, ...booksToAdd]);
      setActiveTab('library');
    }
    setDetectedBooks([]);
    setImageSrc(null);
  };

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes scanBeam {
          0% { top: 0%; opacity: 0.8; }
          50% { top: 95%; opacity: 0.8; }
          100% { top: 0%; opacity: 0.8; }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.7; }
        }
      `}</style>

      <div style={styles.card}>
        <header style={styles.header}>
          <div style={styles.brandContainer}>
            <img 
              src="/apple-icon-180x180.png" 
              alt="ShelfScan AI Logo" 
              style={styles.headerIcon} 
            />
            <h1 style={styles.title}>ShelfScan AI</h1>
          </div>
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

        {/* SCANNER TAB */}
        {activeTab === 'scan' && (
          <div style={styles.section}>
            <div style={styles.modeSelector}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="scanMode"
                  checked={scanMode === 'search_shelf'}
                  onChange={() => setScanMode('search_shelf')}
                />
                <strong>🔍 Search Shelf</strong> (Match against Wishlist)
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="scanMode"
                  checked={scanMode === 'add_wishlist'}
                  onChange={() => setScanMode('add_wishlist')}
                />
                <strong>⭐ Add to Wishlist</strong> (Photo, Barcode/ISBN, or Screenshot)
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="scanMode"
                  checked={scanMode === 'add_library'}
                  onChange={() => setScanMode('add_library')}
                />
                <strong>📚 Add to Library</strong> (Photo, Barcode/ISBN, or Shelf)
              </label>
            </div>

            {/* Hidden Inputs */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={cameraInputRef}
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />

            {/* Action Buttons */}
            <div style={styles.buttonRow}>
              <button
                onClick={() => cameraInputRef.current?.click()}
                disabled={loading}
                style={styles.primaryBtn}
              >
                📷 Take Photo
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                style={styles.secondaryBtn}
              >
                🖼️ Upload Image / Screenshot
              </button>
            </div>

            {imageSrc && (
              <button
                onClick={handleScan}
                disabled={loading}
                style={{ ...styles.primaryBtn, width: '100%', marginTop: '8px', opacity: loading ? 0.6 : 1 }}
              >
                {loading ? 'Analyzing with AI...' : 'Run Scan'}
              </button>
            )}

            {error && <div style={styles.errorBox}>{error}</div>}

            {/* VIEWPORT OVERLAY */}
            {imageSrc && (
              <div style={styles.viewerContainer}>
                <div style={styles.imageWrapper}>
                  <img src={imageSrc} alt="Scan target" style={styles.image} />

                  {loading && (
                    <>
                      <div style={styles.laserLine} />
                      <div style={styles.scanOverlayText}>
                        Scanning with AI...
                      </div>
                    </>
                  )}

                  {!loading && matches.map((match, idx) => {
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

                {/* DETECTED BOOKS CHECKLIST */}
                {!loading && detectedBooks.length > 0 && (
                  <div style={styles.resultsBox}>
                    <h3 style={{ color: '#10b981', margin: '0 0 8px 0' }}>
                      Detected {detectedBooks.length} Book(s):
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                      {detectedBooks.map((b) => (
                        <label key={b.id} style={styles.checkItem}>
                          <input
                            type="checkbox"
                            checked={!!selectedBooks[b.id]}
                            onChange={() => toggleSelectBook(b.id)}
                          />
                          <div>
                            <strong>{b.title}</strong> {b.author && <span style={styles.subtext}>by {b.author}</span>}
                            {b.isbn && <span style={styles.subtext}> (ISBN: {b.isbn})</span>}
                          </div>
                        </label>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      {scanMode === 'add_wishlist' ? (
                        <button
                          onClick={() => handleImportSelected('wishlist')}
                          style={{ ...styles.primaryBtn, width: '100%' }}
                        >
                          Add Selected to Wishlist
                        </button>
                      ) : (
                        <button
                          onClick={() => handleImportSelected('library')}
                          style={{ ...styles.primaryBtn, width: '100%' }}
                        >
                          Add Selected to Library
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* WISHLIST TAB */}
        {activeTab === 'wishlist' && (
          <div style={styles.section}>
            <h2>My Wishlist</h2>
            <div style={styles.addForm}>
              <div style={{ position: 'relative' }}>
                <input
                  placeholder="Book Title (Type to search...)"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  style={styles.input}
                />
                {isSearching && <span style={styles.searchingBadge}>Searching...</span>}

                {suggestions.length > 0 && (
                  <div style={styles.dropdown}>
                    {suggestions.map((s, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectSuggestion(s)}
                        style={styles.dropdownItem}
                      >
                        <strong>{s.title}</strong>
                        <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>
                          by {s.author}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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

        {/* LIBRARY TAB */}
        {activeTab === 'library' && (
          <div style={styles.section}>
            <h2>My Owned Library</h2>
            <div style={styles.addForm}>
              <div style={{ position: 'relative' }}>
                <input
                  placeholder="Book Title (Type to search...)"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  style={styles.input}
                />
                {isSearching && <span style={styles.searchingBadge}>Searching...</span>}

                {suggestions.length > 0 && (
                  <div style={styles.dropdown}>
                    {suggestions.map((s, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectSuggestion(s)}
                        style={styles.dropdownItem}
                      >
                        <strong>{s.title}</strong>
                        <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>
                          by {s.author}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
  brandContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  headerIcon: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    objectFit: 'cover',
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
    gap: '10px',
    backgroundColor: '#1e293b',
    padding: '12px',
    borderRadius: '8px',
  },
  radioLabel: { fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' },
  buttonRow: { display: 'flex', gap: '8px' },
  primaryBtn: {
    flex: 1,
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
    flex: 1,
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
  laserLine: {
    position: 'absolute',
    left: '0',
    right: '0',
    height: '4px',
    backgroundColor: '#10b981',
    boxShadow: '0 0 15px 4px rgba(16, 185, 129, 0.8)',
    animation: 'scanBeam 2s ease-in-out infinite',
    zIndex: 10,
  },
  scanOverlayText: {
    position: 'absolute',
    bottom: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    color: '#10b981',
    fontWeight: 'bold',
    fontSize: '12px',
    padding: '6px 16px',
    borderRadius: '20px',
    border: '1px solid #10b981',
    backdropFilter: 'blur(4px)',
    zIndex: 11,
    animation: 'pulseGlow 1.5s infinite',
  },
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
  checkItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#0f172a',
    padding: '8px',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  addForm: { display: 'flex', flexDirection: 'column', gap: '8px' },
  input: {
    padding: '10px',
    borderRadius: '6px',
    border: '1px solid #334155',
    backgroundColor: '#1e293b',
    color: '#fff',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
  },
  searchingBadge: {
    position: 'absolute',
    right: '10px',
    top: '12px',
    fontSize: '11px',
    color: '#10b981',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '6px',
    zIndex: 20,
    marginTop: '4px',
    maxHeight: '180px',
    overflowY: 'auto',
  },
  dropdownItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid #334155',
    fontSize: '13px',
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
