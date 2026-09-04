import React, { useState, useEffect, useRef } from 'react';

interface Book {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
}

interface MatchResult {
  matchedWishlistItem?: string;
  detectedSpineTitle: string;
  recommendationType?: 'wishlist_match' | 'wishlist_author' | 'library_author' | 'taste_match';
  reason?: string;
  box_2d: [number, number, number, number];
}

interface Suggestion {
  title: string;
  author: string;
}

type ThemeMode = 'dark' | 'purple' | 'light' | 'custom';

interface RecSettings {
  theme: ThemeMode;
  wishlistAuthorRecs: boolean;
  libraryAuthorRecs: boolean;
  tasteRecs: boolean;
  colors: {
    wishlist_match: string;
    wishlist_author: string;
    library_author: string;
    taste_match: string;
  };
  customThemeColors: {
    bg: string;
    cardBg: string;
    text: string;
    accent: string;
    border: string;
  };
}

export default function App() {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';

  // App State
  const [activeTab, setActiveTab] = useState<'scan' | 'wishlist' | 'library'>('scan');
  const [wishlist, setWishlist] = useState<Book[]>([]);
  const [library, setLibrary] = useState<Book[]>([]);

  // Settings State with Theme and Custom Colors
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [recSettings, setRecSettings] = useState<RecSettings>({
    theme: 'dark',
    wishlistAuthorRecs: true,
    libraryAuthorRecs: true,
    tasteRecs: true,
    colors: {
      wishlist_match: '#10b981',
      wishlist_author: '#f59e0b',
      library_author: '#3b82f6',
      taste_match: '#a855f7',
    },
    customThemeColors: {
      bg: '#0f172a',
      cardBg: '#1e293b',
      text: '#f8fafc',
      accent: '#10b981',
      border: '#334155',
    },
  });

  // Scan Mode State
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
    const savedSettings = localStorage.getItem('shelfscan_settings');

    if (savedWishlist) setWishlist(JSON.parse(savedWishlist));
    else setWishlist([
      { id: '1', title: 'Dune', author: 'Frank Herbert' },
      { id: '2', title: 'The Hobbit', author: 'J.R.R. Tolkien' },
      { id: '3', title: 'Neuromancer', author: 'William Gibson' }
    ]);

    if (savedLibrary) setLibrary(JSON.parse(savedLibrary));
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings);
      setRecSettings({
        theme: 'dark',
        ...parsed,
        colors: {
          wishlist_match: '#10b981',
          wishlist_author: '#f59e0b',
          library_author: '#3b82f6',
          taste_match: '#a855f7',
          ...parsed.colors,
        },
        customThemeColors: {
          bg: '#0f172a',
          cardBg: '#1e293b',
          text: '#f8fafc',
          accent: '#10b981',
          border: '#334155',
          ...parsed.customThemeColors,
        },
      });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('shelfscan_wishlist', JSON.stringify(wishlist));
  }, [wishlist]);

  useEffect(() => {
    localStorage.setItem('shelfscan_library', JSON.stringify(library));
  }, [library]);

  useEffect(() => {
    localStorage.setItem('shelfscan_settings', JSON.stringify(recSettings));
  }, [recSettings]);

  // Dynamic Theme Palette Generator
  const getThemeStyles = () => {
    switch (recSettings.theme) {
      case 'custom':
        return {
          bg: recSettings.customThemeColors.bg,
          cardBg: recSettings.customThemeColors.cardBg,
          cardSubBg: recSettings.customThemeColors.bg,
          border: recSettings.customThemeColors.border,
          text: recSettings.customThemeColors.text,
          subtext: recSettings.customThemeColors.text + 'aa',
          accent: recSettings.customThemeColors.accent,
          btnText: recSettings.customThemeColors.bg,
        };
      case 'purple':
        return {
          bg: '#11092b',
          cardBg: '#1d1242',
          cardSubBg: '#0b051d',
          border: '#3b2875',
          text: '#f3e8ff',
          subtext: '#c084fc',
          accent: '#c084fc',
          btnText: '#11092b',
        };
      case 'light':
        return {
          bg: '#f8fafc',
          cardBg: '#ffffff',
          cardSubBg: '#f1f5f9',
          border: '#cbd5e1',
          text: '#0f172a',
          subtext: '#64748b',
          accent: '#0d9488',
          btnText: '#ffffff',
        };
      case 'dark':
      default:
        return {
          bg: '#0f172a',
          cardBg: '#1e293b',
          cardSubBg: '#0f172a',
          border: '#334155',
          text: '#f8fafc',
          subtext: '#94a3b8',
          accent: '#10b981',
          btnText: '#0f172a',
        };
    }
  };

  const theme = getThemeStyles();

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
    e.target.value = '';
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

  const handleQuickAddToLibrary = (title: string) => {
    const exists = library.some((b) => b.title.toLowerCase() === title.toLowerCase());
    if (!exists) {
      setLibrary([...library, { id: Date.now().toString(), title }]);
    }
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
        const wishlistAuthors = Array.from(new Set(wishlist.map((b) => b.author).filter(Boolean)));
        const libraryAuthors = Array.from(new Set(library.map((b) => b.author).filter(Boolean)));
        const libraryTitles = library.map((b) => b.title);

        const prompt = `
          Analyze the book spines on this shelf and return matches or recommendations in JSON based on these criteria:
          1. Direct Wishlist Matches: Titles present in ${JSON.stringify(wishlistTitles)}. Set recommendationType to "wishlist_match".
          ${recSettings.wishlistAuthorRecs ? `2. Wishlist Author Recs: Books on shelf written by these authors: ${JSON.stringify(wishlistAuthors)} which are NOT already in owned library (${JSON.stringify(libraryTitles)}). Set recommendationType to "wishlist_author".` : ''}
          ${recSettings.libraryAuthorRecs ? `3. Library Author Recs: Books on shelf written by these authors: ${JSON.stringify(libraryAuthors)} which are NOT already in owned library (${JSON.stringify(libraryTitles)}). Set recommendationType to "library_author".` : ''}
          ${recSettings.tasteRecs ? `4. Taste Match Recs: Books on shelf matching general reading taste based on wishlist (${JSON.stringify(wishlistTitles)}) and library (${JSON.stringify(libraryTitles)}). Set recommendationType to "taste_match".` : ''}

          Return box_2d coordinates [ymin, xmin, ymax, xmax] normalized from 0-1000 for each match.
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
                  recommendationType: { type: 'STRING' },
                  reason: { type: 'STRING' },
                  box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
                },
                required: ['detectedSpineTitle', 'recommendationType', 'box_2d'],
              },
            },
          },
          required: ['matches'],
        };

        const res = await callGeminiAPI(prompt, compressedBase64, schema);
        setMatches(res.matches || []);

      } else {
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
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

  const handleColorChange = (key: keyof RecSettings['colors'], colorHex: string) => {
    setRecSettings((prev) => ({
      ...prev,
      colors: {
        ...prev.colors,
        [key]: colorHex,
      },
    }));
  };

  const handleCustomThemeColorChange = (key: keyof RecSettings['customThemeColors'], colorHex: string) => {
    setRecSettings((prev) => ({
      ...prev,
      customThemeColors: {
        ...prev.customThemeColors,
        [key]: colorHex,
      },
    }));
  };

  const getColorForRecType = (type?: string) => {
    if (!type || !(type in recSettings.colors)) return recSettings.colors.wishlist_match;
    return recSettings.colors[type as keyof RecSettings['colors']];
  };

  const getLabelForRecType = (type?: string) => {
    switch (type) {
      case 'wishlist_match': return 'Wishlist Match';
      case 'wishlist_author': return 'Wishlist Author';
      case 'library_author': return 'Library Author';
      case 'taste_match': return 'Taste Match';
      default: return 'Match';
    }
  };

  return (
    <div style={{ ...styles.container, backgroundColor: theme.bg, color: theme.text }}>
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
        /* Stack header elements vertically on screens under 500px */
        @media (max-width: 500px) {
          .app-header {
            flex-direction: column !important;
            align-items: center !important;
            gap: 12px !important;
          }
          .app-header-controls {
            width: 100% !important;
            justify-content: space-between !important;
          }
        }
      `}</style>

      <div style={styles.card}>
        <header className="app-header" style={{ ...styles.header, borderColor: theme.border }}>
          <div style={styles.brandContainer}>
            <div style={{ ...styles.headerIconBadge, backgroundColor: theme.cardBg, borderColor: theme.border }}>📚</div>
            <h1 style={{ ...styles.title, color: theme.accent, whiteSpace: 'nowrap' }}>ShelfScan AI</h1>
          </div>
          
          <div className="app-header-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <nav style={styles.nav}>
              <button
                onClick={() => setActiveTab('scan')}
                style={activeTab === 'scan' ? { ...styles.activeNavBtn, backgroundColor: theme.accent, color: theme.btnText } : { ...styles.navBtn, backgroundColor: theme.cardBg, color: theme.subtext }}
              >
                Scan
              </button>
              <button
                onClick={() => setActiveTab('wishlist')}
                style={activeTab === 'wishlist' ? { ...styles.activeNavBtn, backgroundColor: theme.accent, color: theme.btnText } : { ...styles.navBtn, backgroundColor: theme.cardBg, color: theme.subtext }}
              >
                Wishlist ({wishlist.length})
              </button>
              <button
                onClick={() => setActiveTab('library')}
                style={activeTab === 'library' ? { ...styles.activeNavBtn, backgroundColor: theme.accent, color: theme.btnText } : { ...styles.navBtn, backgroundColor: theme.cardBg, color: theme.subtext }}
              >
                Library ({library.length})
              </button>
            </nav>
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              style={{ ...styles.settingsBtn, backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
              title="Settings"
            >
              ⚙️
            </button>
          </div>
        </header>

        {/* SETTINGS PANEL */}
        {showSettings && (
          <div style={{ ...styles.settingsModal, backgroundColor: theme.cardBg, borderColor: theme.border }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: theme.accent }}>Settings</h3>
              <button onClick={() => setShowSettings(false)} style={styles.deleteBtn}>✕</button>
            </div>

            {/* THEME CUSTOMIZATION SELECTOR */}
            <div style={{ margin: '12px 0', borderBottom: `1px solid ${theme.border}`, paddingBottom: '12px' }}>
              <strong style={{ fontSize: '13px', display: 'block', marginBottom: '6px' }}>App Theme:</strong>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setRecSettings({ ...recSettings, theme: 'dark' })}
                  style={{
                    ...styles.themeBtn,
                    backgroundColor: '#0f172a',
                    color: '#f8fafc',
                    border: recSettings.theme === 'dark' ? '2px solid #10b981' : '1px solid #334155',
                  }}
                >
                  Dark
                </button>
                <button
                  onClick={() => setRecSettings({ ...recSettings, theme: 'purple' })}
                  style={{
                    ...styles.themeBtn,
                    backgroundColor: '#11092b',
                    color: '#f3e8ff',
                    border: recSettings.theme === 'purple' ? '2px solid #c084fc' : '1px solid #3b2875',
                  }}
                >
                  Purple
                </button>
                <button
                  onClick={() => setRecSettings({ ...recSettings, theme: 'light' })}
                  style={{
                    ...styles.themeBtn,
                    backgroundColor: '#ffffff',
                    color: '#0f172a',
                    border: recSettings.theme === 'light' ? '2px solid #0d9488' : '1px solid #cbd5e1',
                  }}
                >
                  Light
                </button>
                <button
                  onClick={() => setRecSettings({ ...recSettings, theme: 'custom' })}
                  style={{
                    ...styles.themeBtn,
                    backgroundColor: recSettings.customThemeColors.bg,
                    color: recSettings.customThemeColors.text,
                    border: recSettings.theme === 'custom' ? `2px solid ${recSettings.customThemeColors.accent}` : `1px solid ${theme.border}`,
                  }}
                >
                  Custom 🎨
                </button>
              </div>

              {/* CUSTOM THEME COLOR PICKERS */}
              {recSettings.theme === 'custom' && (
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: theme.cardSubBg, padding: '10px', borderRadius: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Custom Interface Palette:</span>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <label style={styles.colorPickerLabel}>
                      <input
                        type="color"
                        value={recSettings.customThemeColors.bg}
                        onChange={(e) => handleCustomThemeColorChange('bg', e.target.value)}
                        style={styles.colorPicker}
                      />
                      Background
                    </label>

                    <label style={styles.colorPickerLabel}>
                      <input
                        type="color"
                        value={recSettings.customThemeColors.cardBg}
                        onChange={(e) => handleCustomThemeColorChange('cardBg', e.target.value)}
                        style={styles.colorPicker}
                      />
                      Card Surface
                    </label>

                    <label style={styles.colorPickerLabel}>
                      <input
                        type="color"
                        value={recSettings.customThemeColors.text}
                        onChange={(e) => handleCustomThemeColorChange('text', e.target.value)}
                        style={styles.colorPicker}
                      />
                      Text
                    </label>

                    <label style={styles.colorPickerLabel}>
                      <input
                        type="color"
                        value={recSettings.customThemeColors.accent}
                        onChange={(e) => handleCustomThemeColorChange('accent', e.target.value)}
                        style={styles.colorPicker}
                      />
                      Accent / Buttons
                    </label>

                    <label style={styles.colorPickerLabel}>
                      <input
                        type="color"
                        value={recSettings.customThemeColors.border}
                        onChange={(e) => handleCustomThemeColorChange('border', e.target.value)}
                        style={styles.colorPicker}
                      />
                      Borders
                    </label>
                  </div>
                </div>
              )}
            </div>

            <p style={{ fontSize: '12px', color: theme.subtext, margin: '4px 0 12px 0' }}>
              Customise scanning rules and target highlighting colours:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* WISHLIST MATCH COLOR */}
              <div style={{ ...styles.settingRow, backgroundColor: theme.cardSubBg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                  <input
                    type="color"
                    value={recSettings.colors.wishlist_match}
                    onChange={(e) => handleColorChange('wishlist_match', e.target.value)}
                    style={styles.colorPicker}
                  />
                  <div>
                    <strong style={{ fontSize: '13px' }}>Wishlist Match</strong>
                    <span style={{ fontSize: '11px', display: 'block', color: theme.subtext }}>Exact title matches</span>
                  </div>
                </div>
              </div>

              {/* WISHLIST AUTHOR TOGGLE & COLOR */}
              <div style={{ ...styles.settingRow, backgroundColor: theme.cardSubBg }}>
                <input
                  type="checkbox"
                  checked={recSettings.wishlistAuthorRecs}
                  onChange={(e) => setRecSettings({ ...recSettings, wishlistAuthorRecs: e.target.checked })}
                />
                <input
                  type="color"
                  value={recSettings.colors.wishlist_author}
                  onChange={(e) => handleColorChange('wishlist_author', e.target.value)}
                  style={styles.colorPicker}
                />
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: '13px' }}>Wishlist Authors</strong>
                  <span style={{ fontSize: '11px', display: 'block', color: theme.subtext }}>Unowned books by wishlist authors</span>
                </div>
              </div>

              {/* LIBRARY AUTHOR TOGGLE & COLOR */}
              <div style={{ ...styles.settingRow, backgroundColor: theme.cardSubBg }}>
                <input
                  type="checkbox"
                  checked={recSettings.libraryAuthorRecs}
                  onChange={(e) => setRecSettings({ ...recSettings, libraryAuthorRecs: e.target.checked })}
                />
                <input
                  type="color"
                  value={recSettings.colors.library_author}
                  onChange={(e) => handleColorChange('library_author', e.target.value)}
                  style={styles.colorPicker}
                />
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: '13px' }}>Library Authors</strong>
                  <span style={{ fontSize: '11px', display: 'block', color: theme.subtext }}>Unowned books by owned authors</span>
                </div>
              </div>

              {/* TASTE MATCH TOGGLE & COLOR */}
              <div style={{ ...styles.settingRow, backgroundColor: theme.cardSubBg }}>
                <input
                  type="checkbox"
                  checked={recSettings.tasteRecs}
                  onChange={(e) => setRecSettings({ ...recSettings, tasteRecs: e.target.checked })}
                />
                <input
                  type="color"
                  value={recSettings.colors.taste_match}
                  onChange={(e) => handleColorChange('taste_match', e.target.value)}
                  style={styles.colorPicker}
                />
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: '13px' }}>Taste Match</strong>
                  <span style={{ fontSize: '11px', display: 'block', color: theme.subtext }}>Recommendations matching general taste</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SCANNER TAB */}
        {activeTab === 'scan' && (
          <div style={styles.section}>
            <div style={{ ...styles.modeSelector, backgroundColor: theme.cardBg }}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="scanMode"
                  checked={scanMode === 'search_shelf'}
                  onChange={() => setScanMode('search_shelf')}
                />
                Search Shelf
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="scanMode"
                  checked={scanMode === 'add_wishlist'}
                  onChange={() => setScanMode('add_wishlist')}
                />
                Add to Wishlist
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="scanMode"
                  checked={scanMode === 'add_library'}
                  onChange={() => setScanMode('add_library')}
                />
                Add to Library
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
                style={{ ...styles.primaryBtn, backgroundColor: theme.accent, color: theme.btnText }}
              >
                📷 Take Photo
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                style={{ ...styles.secondaryBtn, backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
              >
                🖼️ Upload Image / Screenshot
              </button>
            </div>

            {imageSrc && (
              <button
                onClick={handleScan}
                disabled={loading}
                style={{ ...styles.primaryBtn, backgroundColor: theme.accent, color: theme.btnText, width: '100%', marginTop: '8px', opacity: loading ? 0.6 : 1 }}
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
                      <div style={{ ...styles.laserLine, backgroundColor: theme.accent }} />
                      <div style={{ ...styles.scanOverlayText, borderColor: theme.accent, color: theme.accent }}>
                        Scanning with AI...
                      </div>
                    </>
                  )}

                  {!loading && matches.map((match, idx) => {
                    const [ymin, xmin, ymax, xmax] = match.box_2d;
                    const color = getColorForRecType(match.recommendationType);

                    const boxStyle: React.CSSProperties = {
                      position: 'absolute',
                      top: `${ymin / 10}%`,
                      left: `${xmin / 10}%`,
                      height: `${(ymax - ymin) / 10}%`,
                      width: `${(xmax - xmin) / 10}%`,
                      border: `3px solid ${color}`,
                      backgroundColor: `${color}33`,
                      boxSizing: 'border-box',
                      pointerEvents: 'none',
                    };

                    return (
                      <div key={idx} style={boxStyle}>
                        <span style={{ ...styles.badge, backgroundColor: color, color: '#0f172a' }}>
                          {match.matchedWishlistItem || match.detectedSpineTitle}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* DETECTED MATCHES WITH INSTANT ADD-TO-LIBRARY BUTTON */}
                {!loading && matches.length > 0 && scanMode === 'search_shelf' && (
                  <div style={{ ...styles.resultsBox, backgroundColor: theme.cardBg, borderColor: theme.border }}>
                    <h3 style={{ color: theme.accent, margin: '0 0 8px 0' }}>
                      Shelf Results ({matches.length}):
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                      {matches.map((m, idx) => {
                        const color = getColorForRecType(m.recommendationType);
                        const itemTitle = m.matchedWishlistItem || m.detectedSpineTitle;
                        const isOwned = library.some((b) => b.title.toLowerCase() === itemTitle.toLowerCase());

                        return (
                          <div key={idx} style={{ ...styles.matchResultCard, backgroundColor: theme.cardSubBg, borderLeft: `4px solid ${color}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <strong>{itemTitle}</strong>
                                {m.reason && <div style={{ fontSize: '11px', color: theme.subtext, marginTop: '2px' }}>{m.reason}</div>}
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ ...styles.typePill, backgroundColor: color }}>
                                  {getLabelForRecType(m.recommendationType)}
                                </span>

                                <button
                                  onClick={() => handleQuickAddToLibrary(itemTitle)}
                                  disabled={isOwned}
                                  style={{
                                    ...styles.quickAddBtn,
                                    backgroundColor: isOwned ? theme.border : theme.accent,
                                    color: isOwned ? theme.subtext : theme.btnText,
                                  }}
                                  title="Add to Library"
                                >
                                  {isOwned ? '✓ Owned' : '+ Library'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!loading && detectedBooks.length > 0 && scanMode !== 'search_shelf' && (
                  <div style={{ ...styles.resultsBox, backgroundColor: theme.cardBg, borderColor: theme.border }}>
                    <h3 style={{ color: theme.accent, margin: '0 0 8px 0' }}>
                      Detected {detectedBooks.length} Book(s):
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                      {detectedBooks.map((b) => (
                        <label key={b.id} style={{ ...styles.checkItem, backgroundColor: theme.cardSubBg }}>
                          <input
                            type="checkbox"
                            checked={!!selectedBooks[b.id]}
                            onChange={() => toggleSelectBook(b.id)}
                          />
                          <div>
                            <strong>{b.title}</strong> {b.author && <span style={{ fontSize: '12px', color: theme.subtext }}>by {b.author}</span>}
                            {b.isbn && <span style={{ fontSize: '12px', color: theme.subtext }}> (ISBN: {b.isbn})</span>}
                          </div>
                        </label>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      {scanMode === 'add_wishlist' ? (
                        <button
                          onClick={() => handleImportSelected('wishlist')}
                          style={{ ...styles.primaryBtn, backgroundColor: theme.accent, color: theme.btnText, width: '100%' }}
                        >
                          Add Selected to Wishlist
                        </button>
                      ) : (
                        <button
                          onClick={() => handleImportSelected('library')}
                          style={{ ...styles.primaryBtn, backgroundColor: theme.accent, color: theme.btnText, width: '100%' }}
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
                  style={{ ...styles.input, backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
                />
                {isSearching && <span style={{ ...styles.searchingBadge, color: theme.accent }}>Searching...</span>}

                {suggestions.length > 0 && (
                  <div style={{ ...styles.dropdown, backgroundColor: theme.cardBg, borderColor: theme.border }}>
                    {suggestions.map((s, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectSuggestion(s)}
                        style={{ ...styles.dropdownItem, borderColor: theme.border }}
                      >
                        <strong>{s.title}</strong>
                        <span style={{ fontSize: '11px', color: theme.subtext, display: 'block' }}>
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
                style={{ ...styles.input, backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
              />
              <button onClick={() => handleAddManual('wishlist')} style={{ ...styles.primaryBtn, backgroundColor: theme.accent, color: theme.btnText }}>
                Add to Wishlist
              </button>
            </div>

            <ul style={styles.list}>
              {wishlist.map((b) => (
                <li key={b.id} style={{ ...styles.listItem, backgroundColor: theme.cardBg, borderColor: theme.border }}>
                  <div>
                    <strong>{b.title}</strong>
                    {b.author && <span style={{ fontSize: '12px', color: theme.subtext }}> by {b.author}</span>}
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
                  style={{ ...styles.input, backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
                />
                {isSearching && <span style={{ ...styles.searchingBadge, color: theme.accent }}>Searching...</span>}

                {suggestions.length > 0 && (
                  <div style={{ ...styles.dropdown, backgroundColor: theme.cardBg, borderColor: theme.border }}>
                    {suggestions.map((s, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectSuggestion(s)}
                        style={{ ...styles.dropdownItem, borderColor: theme.border }}
                      >
                        <strong>{s.title}</strong>
                        <span style={{ fontSize: '11px', color: theme.subtext, display: 'block' }}>
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
                style={{ ...styles.input, backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
              />
              <button onClick={() => handleAddManual('library')} style={{ ...styles.primaryBtn, backgroundColor: theme.accent, color: theme.btnText }}>
                Add to Library
              </button>
            </div>

            <ul style={styles.list}>
              {library.length === 0 ? (
                <p style={{ color: theme.subtext, fontSize: '12px' }}>No books in your library yet. Add manually or scan your bookshelf!</p>
              ) : (
                library.map((b) => (
                  <li key={b.id} style={{ ...styles.listItem, backgroundColor: theme.cardBg, borderColor: theme.border }}>
                    <div>
                      <strong>{b.title}</strong>
                      {b.author && <span style={{ fontSize: '12px', color: theme.subtext }}> by {b.author}</span>}
                      {b.isbn && <div style={{ fontSize: '12px', color: theme.subtext }}>ISBN: {b.isbn}</div>}
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
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '16px',
    display: 'flex',
    justifyContent: 'center',
    transition: 'background-color 0.2s ease',
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
    borderBottom: '1px solid',
    paddingBottom: '12px',
  },
  brandContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  headerIconBadge: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    border: '1px solid',
  },
  title: { margin: 0, fontSize: '20px' },
  nav: { display: 'flex', gap: '8px' },
  navBtn: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
  },
  activeNavBtn: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '12px',
  },
  settingsBtn: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid',
    cursor: 'pointer',
    fontSize: '14px',
  },
  settingsModal: {
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid',
  },
  themeBtn: {
    padding: '6px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  settingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px',
    borderRadius: '6px',
  },
  colorPickerLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    cursor: 'pointer',
  },
  colorPicker: {
    border: 'none',
    width: '26px',
    height: '26px',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  section: { display: 'flex', flexDirection: 'column', gap: '12px' },
  modeSelector: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px',
    borderRadius: '8px',
  },
  radioLabel: { fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 'bold' },
  buttonRow: { display: 'flex', gap: '8px' },
  primaryBtn: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: '6px',
    border: 'none',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '13px',
  },
  secondaryBtn: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: '6px',
    border: '1px solid',
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
    fontWeight: 'bold',
    fontSize: '12px',
    padding: '6px 16px',
    borderRadius: '20px',
    border: '1px solid',
    backdropFilter: 'blur(4px)',
    zIndex: 11,
    animation: 'pulseGlow 1.5s infinite',
  },
  badge: {
    position: 'absolute',
    top: '-24px',
    left: '0',
    fontWeight: 'bold',
    fontSize: '11px',
    padding: '2px 6px',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
  },
  resultsBox: {
    padding: '12px',
    borderRadius: '6px',
    border: '1px solid',
  },
  matchResultCard: {
    padding: '8px 10px',
    borderRadius: '4px',
    fontSize: '13px',
  },
  typePill: {
    color: '#0f172a',
    fontWeight: 'bold',
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '4px',
    textTransform: 'uppercase',
  },
  quickAddBtn: {
    border: 'none',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  checkItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  addForm: { display: 'flex', flexDirection: 'column', gap: '8px' },
  input: {
    padding: '10px',
    borderRadius: '6px',
    border: '1px solid',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
  },
  searchingBadge: {
    position: 'absolute',
    right: '10px',
    top: '12px',
    fontSize: '11px',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    border: '1px solid',
    borderRadius: '6px',
    zIndex: 20,
    marginTop: '4px',
    maxHeight: '180px',
    overflowY: 'auto',
  },
  dropdownItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid',
    fontSize: '13px',
  },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' },
  listItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    borderRadius: '6px',
    border: '1px solid',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#ef4444',
    fontSize: '16px',
    cursor: 'pointer',
  },
};
