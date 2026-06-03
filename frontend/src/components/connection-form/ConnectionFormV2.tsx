import { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  ConnectionFormData,
  TabId,
  FormMode,
  TestConnectionResult,
} from './ConnectionFormTypes';
import { DEFAULT_FORM_DATA } from './ConnectionFormTypes';
import { generateURIFromForm, parseURIIntoForm } from './ConnectionFormURIUtils';
import { validateForm, countErrorsPerTab } from './ConnectionFormValidation';
import { TabNavigation } from './components/TabNavigation';
import { ModeToggle } from './components/ModeToggle';
import { ValidationSummary } from './components/ValidationSummary';
import { StickyErrorBanner } from './components/StickyErrorBanner';
import { ConnectionTab } from './tabs/ConnectionTab';
import { AuthenticationTab } from './tabs/AuthenticationTab';
import { NetworkTab } from './tabs/NetworkTab';
import { OptionsTab } from './tabs/OptionsTab';
import { SafetyTab } from './tabs/SafetyTab';
import { AppearanceTab } from './tabs/AppearanceTab';
import ConnectionShareOverlay from './components/ConnectionShareOverlay';

interface ConnectionFormV2Props {
  connection?: any; // SavedConnection or ExtendedConnection
  folders: Array<{ id: string; name: string }>;
  onSave: (conn: any) => void;
  onCancel: () => void;
}

export function ConnectionFormV2({ connection, folders, onSave, onCancel }: ConnectionFormV2Props) {
  // Initialize form data
  const [formData, setFormData] = useState<ConnectionFormData>(() => {
    if (connection) {
      // Basic initialization - will be replaced by loaded extended connection
      return {
        ...DEFAULT_FORM_DATA,
        id: connection.id,
        name: connection.name,
        folderId: connection.folderId || '',
        color: connection.color || '#4CC38A',
        readOnly: connection.readOnly || false,
      };
    } else {
      return {
        ...DEFAULT_FORM_DATA,
        id: crypto.randomUUID(),
        name: '',
      };
    }
  });

  const [mode, setMode] = useState<FormMode>('form');
  const [activeTab, setActiveTab] = useState<TabId>('connection');

  // Progressive disclosure: Basic vs Advanced mode
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => {
    if (!connection) return false;
    // Auto-enable advanced when editing a connection that uses advanced features
    return !!(
      connection.sshEnabled || connection.socks5Enabled || connection.tlsEnabled ||
      (connection.compressors && connection.compressors.length > 0) ||
      (connection.hosts && connection.hosts.length > 1)
    );
  });
  const [uriText, setUriText] = useState('');
  const [uriParseError, setUriParseError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [uriValidation, setUriValidation] = useState<{ valid: boolean; error?: string } | null>(null);
  const [uriCopied, setUriCopied] = useState(false);
  const [uriIncludeCredentials, setUriIncludeCredentials] = useState(false);
  const [uriIncludeMongoPalParams, setUriIncludeMongoPalParams] = useState(true);
  const [showParseOverlay, setShowParseOverlay] = useState(false);
  const [shareOverlay, setShareOverlay] = useState<'export' | 'import' | null>(null);

  // Track which passwords exist but haven't been loaded (for security)
  const [passwordExists, setPasswordExists] = useState(false);
  const [sshPasswordExists, setSSHPasswordExists] = useState(false);
  const [sshPassphraseExists, setSSHPassphraseExists] = useState(false);
  const [socks5PasswordExists, setSOCKS5PasswordExists] = useState(false);
  const [tlsKeyPasswordExists, setTLSKeyPasswordExists] = useState(false);

  // Load extended connection when editing (WITHOUT loading passwords into memory)
  useEffect(() => {
    if (!connection?.id) return;

    const loadExtendedConnection = async () => {
      try {
        const go = window.go?.main?.App;
        if (!go?.GetExtendedConnection) {
          console.error('GetExtendedConnection not available');
          return;
        }

        const extendedConn = await go.GetExtendedConnection(connection.id);

        // Track which passwords exist (but don't load them into form yet)
        setPasswordExists(!!extendedConn.mongoPassword);
        setSSHPasswordExists(!!extendedConn.sshPassword);
        setSSHPassphraseExists(!!extendedConn.sshPassphrase);
        setSOCKS5PasswordExists(!!extendedConn.socks5Password);
        setTLSKeyPasswordExists(!!extendedConn.tlsKeyPassword);

        // If FormData is stored, use it (but strip passwords for security)
        if (extendedConn.formData) {
          try {
            const storedFormData = JSON.parse(extendedConn.formData);
            // Strip passwords - they should be loaded on reveal only
            storedFormData.password = '';
            storedFormData.sshPassword = '';
            storedFormData.sshPassphrase = '';
            storedFormData.socks5Password = '';
            storedFormData.tlsClientKeyPassword = '';
            setFormData(storedFormData);
            return;
          } catch (err) {
            console.warn('Failed to parse stored FormData, will reconstruct from connection:', err);
          }
        }

        // Otherwise, construct form data from extended connection (WITHOUT passwords)
        const parsedFormData: ConnectionFormData = {
          ...DEFAULT_FORM_DATA,
          id: extendedConn.id,
          name: extendedConn.name,
          folderId: extendedConn.folderId || '',
          color: extendedConn.color || '#4CC38A',
          readOnly: extendedConn.readOnly || false,

          // Parse MongoDB URI to extract connection details (password will be empty)
          ...(extendedConn.mongoUri ? parseURIIntoForm(extendedConn.mongoUri) : {}),

          // DO NOT populate passwords - they'll be loaded on reveal
          password: '',

          // SSH settings (without passwords)
          sshEnabled: extendedConn.sshEnabled || false,
          sshHost: extendedConn.sshHost || '',
          sshPort: extendedConn.sshPort || 22,
          sshUser: extendedConn.sshUser || '',
          sshPassword: '',
          sshPrivateKey: extendedConn.sshPrivateKey || '',
          sshPassphrase: '',
          sshAuthMethod: extendedConn.sshPrivateKey ? 'privatekey' : 'password',

          // TLS settings (without key password)
          tlsEnabled: extendedConn.tlsEnabled || false,
          tlsInsecure: extendedConn.tlsInsecure || false,
          tlsCACert: extendedConn.tlsCAFile || '',
          tlsClientCert: extendedConn.tlsCertFile || '',
          tlsClientKey: extendedConn.tlsKeyFile || '',
          tlsClientKeyPassword: '',

          // SOCKS5 settings (without password)
          socks5Enabled: extendedConn.socks5Enabled || false,
          socks5Host: extendedConn.socks5Host || '',
          socks5Port: extendedConn.socks5Port || 1080,
          socks5User: extendedConn.socks5User || '',
          socks5Password: '',
          socks5RequiresAuth: !!(extendedConn.socks5User || extendedConn.socks5Password),

          // Safety settings
          destructiveDelay: extendedConn.destructiveDelay || 0,
          requireDeleteConfirmation: extendedConn.requireDeleteConfirmation || false,
        };

        setFormData(parsedFormData);

        // Auto-enable advanced mode if extended connection uses advanced features
        if (extendedConn.sshEnabled || extendedConn.socks5Enabled || extendedConn.tlsEnabled ||
            (extendedConn.compressors && extendedConn.compressors.length > 0)) {
          setShowAdvanced(true);
        }
      } catch (err) {
        console.error('Failed to load extended connection:', err);
        // Keep the basic form data we initialized with
      }
    };

    loadExtendedConnection();
  }, [connection?.id]);

  // Generate URI from form data
  const generatedURI = useMemo(() => {
    try {
      return generateURIFromForm(formData);
    } catch (error) {
      return 'Invalid form data';
    }
  }, [formData]);

  // Sync URI text when switching to URI mode
  useEffect(() => {
    if (mode === 'uri' && !uriText) {
      setUriText(generatedURI);
    }
  }, [mode, generatedURI, uriText]);

  // Debounced URI inline validation
  useEffect(() => {
    if (mode !== 'uri' || !uriText.trim()) {
      setUriValidation(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        parseURIIntoForm(uriText);
        setUriValidation({ valid: true });
      } catch (error) {
        setUriValidation({ valid: false, error: error instanceof Error ? error.message : 'Invalid URI' });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [uriText, mode]);

  const handleCopyURI = useCallback(async () => {
    try {
      const uri = generateURIFromForm(formData, {
        includeCredentials: uriIncludeCredentials,
        includeMongoPalParams: uriIncludeMongoPalParams,
      });
      await navigator.clipboard.writeText(uri);
      setUriCopied(true);
      setTimeout(() => setUriCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
    }
  }, [formData, uriIncludeCredentials, uriIncludeMongoPalParams]);

  const handleImportedFromOverlay = () => {
    // After a successful import in the overlay, close it and switch to form mode
    setShareOverlay(null);
    setMode('form');
  };

  // Validate form
  const errors = useMemo(() => validateForm(formData), [formData]);
  const errorCounts = useMemo(() => countErrorsPerTab(errors), [errors]);

  // Tab information (6 tabs)
  const tabs = [
    { id: 'connection' as TabId, label: 'Connection', errorCount: errorCounts.connection.errors, warningCount: errorCounts.connection.warnings },
    { id: 'authentication' as TabId, label: 'Authentication', errorCount: errorCounts.authentication.errors, warningCount: errorCounts.authentication.warnings },
    { id: 'network' as TabId, label: 'Network', errorCount: errorCounts.network.errors, warningCount: errorCounts.network.warnings },
    { id: 'options' as TabId, label: 'Options', errorCount: errorCounts.options.errors, warningCount: errorCounts.options.warnings },
    { id: 'safety' as TabId, label: 'Safety', errorCount: errorCounts.safety.errors, warningCount: errorCounts.safety.warnings },
    { id: 'appearance' as TabId, label: 'Appearance', errorCount: errorCounts.appearance.errors, warningCount: errorCounts.appearance.warnings },
  ];

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      // Cmd/Ctrl+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      // Cmd/Ctrl+T to test connection
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        handleTestConnection();
        return;
      }

      // Cmd/Ctrl+[ for previous tab
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        const currentIndex = tabs.findIndex(t => t.id === activeTab);
        if (currentIndex > 0) {
          setActiveTab(tabs[currentIndex - 1].id);
        }
        return;
      }

      // Cmd/Ctrl+] for next tab
      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault();
        const currentIndex = tabs.findIndex(t => t.id === activeTab);
        if (currentIndex < tabs.length - 1) {
          setActiveTab(tabs[currentIndex + 1].id);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, tabs, onCancel]);

  const handleFormDataChange = (updates: Partial<ConnectionFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  // Password loading helpers - load actual passwords from backend when revealed
  const loadMongoPassword = async (): Promise<string> => {
    if (!connection?.id) return '';
    try {
      const go = window.go?.main?.App;
      if (!go?.GetExtendedConnection) return '';
      const extendedConn = await go.GetExtendedConnection(connection.id);
      return extendedConn.mongoPassword || '';
    } catch (err) {
      console.error('Failed to load MongoDB password:', err);
      return '';
    }
  };

  const loadSSHPassword = async (): Promise<string> => {
    if (!connection?.id) return '';
    try {
      const go = window.go?.main?.App;
      if (!go?.GetExtendedConnection) return '';
      const extendedConn = await go.GetExtendedConnection(connection.id);
      return extendedConn.sshPassword || '';
    } catch (err) {
      console.error('Failed to load SSH password:', err);
      return '';
    }
  };

  const loadSSHPassphrase = async (): Promise<string> => {
    if (!connection?.id) return '';
    try {
      const go = window.go?.main?.App;
      if (!go?.GetExtendedConnection) return '';
      const extendedConn = await go.GetExtendedConnection(connection.id);
      return extendedConn.sshPassphrase || '';
    } catch (err) {
      console.error('Failed to load SSH passphrase:', err);
      return '';
    }
  };

  const loadSOCKS5Password = async (): Promise<string> => {
    if (!connection?.id) return '';
    try {
      const go = window.go?.main?.App;
      if (!go?.GetExtendedConnection) return '';
      const extendedConn = await go.GetExtendedConnection(connection.id);
      return extendedConn.socks5Password || '';
    } catch (err) {
      console.error('Failed to load SOCKS5 password:', err);
      return '';
    }
  };

  const loadTLSKeyPassword = async (): Promise<string> => {
    if (!connection?.id) return '';
    try {
      const go = window.go?.main?.App;
      if (!go?.GetExtendedConnection) return '';
      const extendedConn = await go.GetExtendedConnection(connection.id);
      return extendedConn.tlsKeyPassword || '';
    } catch (err) {
      console.error('Failed to load TLS key password:', err);
      return '';
    }
  };

  const handleModeChange = (newMode: FormMode) => {
    if (newMode === 'uri') {
      // Switching to URI mode - generate URI from form
      setUriText(generatedURI);
      setUriParseError(null);
    } else {
      // Switching to Form mode - try to parse URI
      if (uriText && uriText !== generatedURI) {
        try {
          const parsed = parseURIIntoForm(uriText);
          setFormData(prev => ({ ...prev, ...parsed }));
          setUriParseError(null);
        } catch (error) {
          setUriParseError(error instanceof Error ? error.message : 'Failed to parse URI');
          return; // Don't switch mode if parse fails
        }
      }
    }
    setMode(newMode);
  };

  const handleParseURI = () => {
    try {
      const parsed = parseURIIntoForm(uriText);
      setFormData(prev => ({ ...prev, ...parsed }));
      setUriParseError(null);
      setMode('form');
      return true;
    } catch (error) {
      setUriParseError(error instanceof Error ? error.message : 'Failed to parse URI');
      return false;
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const testURI = mode === 'uri' ? uriText : generatedURI;
      const result = await window.go?.main?.App?.TestConnection(testURI, connection?.id || '');
      if (result) {
        setTestResult(result);
      } else {
        setTestResult({ success: false, error: 'No response from server' });
      }
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    // Validate
    if (errors.some(e => e.severity === 'error')) {
      // Jump to first error tab
      const firstErrorTab = errors.find(e => e.severity === 'error')?.tab;
      if (firstErrorTab) {
        setActiveTab(firstErrorTab);
      }
      return;
    }

    // Build ExtendedConnection object
    const extendedConn = {
      id: formData.id,
      name: formData.name,
      folderId: formData.folderId,
      color: formData.color,
      readOnly: formData.readOnly,
      createdAt: connection?.createdAt || new Date().toISOString(),
      lastAccessedAt: connection?.lastAccessedAt || new Date(0).toISOString(),

      // MongoDB
      mongoUri: generatedURI,
      mongoPassword: '',

      // SSH
      sshEnabled: formData.sshEnabled,
      sshHost: formData.sshHost || '',
      sshPort: formData.sshPort,
      sshUser: formData.sshUser || '',
      sshPassword: formData.sshPassword || '',
      sshPrivateKey: formData.sshPrivateKey || '',
      sshPassphrase: formData.sshPassphrase || '',

      // TLS
      tlsEnabled: formData.tlsEnabled,
      tlsInsecure: formData.tlsInsecure,
      tlsCAFile: formData.tlsCACert || '',
      tlsCertFile: formData.tlsClientCert || '',
      tlsKeyFile: formData.tlsClientKey || '',
      tlsKeyPassword: formData.tlsClientKeyPassword || '',

      // SOCKS5
      socks5Enabled: formData.socks5Enabled,
      socks5Host: formData.socks5Host || '',
      socks5Port: formData.socks5Port,
      socks5User: formData.socks5User || '',
      socks5Password: formData.socks5Password || '',

      // Safety
      destructiveDelay: formData.destructiveDelay,
      requireDeleteConfirmation: formData.requireDeleteConfirmation,

      // Store form data as JSON for future editing
      formData: JSON.stringify(formData),
    };

    onSave(extendedConn);
  };

  const tabErrors = errors.filter(e => e.tab === activeTab);

  const handleJumpToError = (tabId: TabId, field: string) => {
    setActiveTab(tabId);

    // Auto-focus the field after tab switch
    setTimeout(() => {
      const fieldEl = document.getElementById(`field-${field}`);
      if (fieldEl) {
        fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        fieldEl.focus();
        fieldEl.classList.add('field-error-highlight');
        setTimeout(() => fieldEl.classList.remove('field-error-highlight'), 2000);
      }
    }, 100);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background text-text rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col relative">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-xl font-semibold text-text">
            {connection ? 'Edit Connection' : 'New Connection'}
          </h2>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={showAdvanced}
                  onChange={e => setShowAdvanced(e.target.checked)}
                  className="sr-only peer"
                  data-testid="advanced-toggle"
                />
                <div className="w-8 h-[18px] bg-surface-hover peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[14px] after:w-[14px] after:transition-all peer-checked:bg-primary"></div>
              </div>
              <span className="text-xs text-text-muted">Advanced</span>
            </label>
            <ModeToggle mode={mode} onModeChange={handleModeChange} />
            <button
              onClick={onCancel}
              className="text-text-muted hover:text-text transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Mode-specific content */}
        {mode === 'form' ? (
          <>
            {/* Tab Navigation */}
            <TabNavigation
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Sticky Error Banner */}
              <StickyErrorBanner errors={errors} onJumpToError={handleJumpToError} />

              {activeTab === 'connection' && (
                <ConnectionTab
                  data={formData}
                  errors={tabErrors}
                  folders={folders}
                  onChange={handleFormDataChange}
                  showAdvanced={showAdvanced}
                />
              )}
              {activeTab === 'authentication' && (
                <AuthenticationTab
                  data={formData}
                  errors={tabErrors}
                  onChange={handleFormDataChange}
                  passwordExists={passwordExists}
                  onLoadPassword={loadMongoPassword}
                  showAdvanced={showAdvanced}
                />
              )}
              {activeTab === 'network' && (
                <NetworkTab
                  data={formData}
                  errors={tabErrors}
                  onChange={handleFormDataChange}
                  sshPasswordExists={sshPasswordExists}
                  onLoadSSHPassword={loadSSHPassword}
                  sshPassphraseExists={sshPassphraseExists}
                  onLoadSSHPassphrase={loadSSHPassphrase}
                  socks5PasswordExists={socks5PasswordExists}
                  onLoadSOCKS5Password={loadSOCKS5Password}
                  tlsKeyPasswordExists={tlsKeyPasswordExists}
                  onLoadTLSKeyPassword={loadTLSKeyPassword}
                  showAdvanced={showAdvanced}
                  onEnableAdvanced={() => setShowAdvanced(true)}
                />
              )}
              {activeTab === 'options' && (
                <OptionsTab
                  data={formData}
                  errors={tabErrors}
                  onChange={handleFormDataChange}
                  showAdvanced={showAdvanced}
                />
              )}
              {activeTab === 'safety' && (
                <SafetyTab
                  data={formData}
                  errors={tabErrors}
                  onChange={handleFormDataChange}
                />
              )}
              {activeTab === 'appearance' && (
                <AppearanceTab
                  data={formData}
                  errors={tabErrors}
                  onChange={handleFormDataChange}
                />
              )}
            </div>
          </>
        ) : (
          // URI Mode
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Share as URI */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Share as URI</h3>
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={uriIncludeCredentials}
                    onChange={e => setUriIncludeCredentials(e.target.checked)}
                    className="rounded border-border-light bg-surface text-primary focus:ring-primary focus:ring-offset-0 w-3.5 h-3.5"
                  />
                  Include credentials
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={uriIncludeMongoPalParams}
                    onChange={e => setUriIncludeMongoPalParams(e.target.checked)}
                    className="rounded border-border-light bg-surface text-primary focus:ring-primary focus:ring-offset-0 w-3.5 h-3.5"
                  />
                  Include MongoPal properties
                </label>
              </div>
              <div
                className="w-full px-3 py-2.5 bg-surface border border-border rounded-md text-text-secondary font-mono text-sm break-all min-h-[44px] cursor-text select-all"
                onClick={e => {
                  const sel = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(e.currentTarget);
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }}
              >
                {generatedURI !== 'Invalid form data'
                  ? generateURIFromForm(formData, {
                      includeCredentials: uriIncludeCredentials,
                      includeMongoPalParams: uriIncludeMongoPalParams,
                    })
                  : <span className="text-text-dim italic">Fill in form fields to generate a URI</span>
                }
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyURI}
                  className="px-3 py-1.5 text-sm bg-primary hover:bg-primary/80 text-white rounded-md transition-colors flex items-center gap-1.5"
                >
                  {uriCopied ? 'Copied' : 'Copy URI'}
                </button>
                <button
                  onClick={() => { setUriText(''); setUriParseError(null); setShowParseOverlay(true); }}
                  className="px-3 py-1.5 text-sm border border-border-light hover:border-border-hover text-text-secondary hover:text-text rounded-md transition-colors"
                >
                  Import from URI...
                </button>
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Share Encrypted */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Share Encrypted</h3>
              <p className="text-xs text-text-muted">
                Export the full connection config including credentials, SSH, TLS, and proxy settings — encrypted with a one-time key.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShareOverlay('export')}
                  disabled={!connection?.id}
                  className="px-3 py-1.5 text-sm bg-primary hover:bg-primary/80 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Export Encrypted...
                </button>
                <button
                  onClick={() => setShareOverlay('import')}
                  className="px-3 py-1.5 text-sm border border-border-light hover:border-border-hover text-text-secondary hover:text-text rounded-md transition-colors"
                >
                  Import Encrypted...
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Parse URI overlay */}
        {showParseOverlay && (
          <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center p-6">
            <div className="bg-background text-text border border-border rounded-lg shadow-2xl w-full max-w-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-text">Import from URI</h3>
                <button
                  onClick={() => setShowParseOverlay(false)}
                  className="text-text-muted hover:text-text text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <textarea
                value={uriText}
                onChange={e => {
                  setUriText(e.target.value);
                  setUriParseError(null);
                }}
                autoFocus
                className={`
                  w-full h-28 px-3 py-2 bg-surface border rounded-md text-text font-mono text-sm resize-none focus:outline-none focus:ring-2
                  ${uriParseError ? 'border-red-500 focus:ring-red-500' : 'border-border focus:ring-primary'}
                `}
                placeholder="mongodb://localhost:27017"
              />
              {uriParseError && (
                <p className="text-xs text-error">{uriParseError}</p>
              )}
              {uriValidation && !uriParseError && (
                <span className={`text-xs flex items-center gap-1 ${uriValidation.valid ? 'text-success' : 'text-error'}`}>
                  {uriValidation.valid ? (
                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  )}
                  {uriValidation.valid ? 'Valid' : uriValidation.error}
                </span>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setShowParseOverlay(false)}
                  className="px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (handleParseURI()) {
                      setShowParseOverlay(false);
                    }
                  }}
                  disabled={!uriText.trim()}
                  className="px-3 py-1.5 text-sm bg-primary hover:bg-primary/80 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Parse into Form
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Share overlay (export / import) */}
        {shareOverlay === 'export' && connection?.id && (
          <ConnectionShareOverlay
            mode="export"
            connectionId={connection.id}
            connectionName={formData.name || 'Untitled'}
            onClose={() => setShareOverlay(null)}
          />
        )}
        {shareOverlay === 'import' && (
          <ConnectionShareOverlay
            mode="import"
            onImported={handleImportedFromOverlay}
            onClose={() => setShareOverlay(null)}
          />
        )}

        {/* Validation Summary */}
        {errors.length > 0 && (
          <ValidationSummary errors={errors} onJumpToError={handleJumpToError} />
        )}

        {/* Test Result Panel */}
        {testResult && (
          <div className={`px-6 py-3 border-t ${
            testResult.success ? 'bg-success-dark/20 border-green-800' : 'bg-error-dark/20 border-red-800'
          }`}>
            <div className="flex items-start gap-3">
              {testResult.success ? (
                <svg className="w-5 h-5 text-success flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-error flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-text">
                  {testResult.success ? 'Connection successful' : 'Connection failed'}
                </div>
                {testResult.success && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-green-300">
                    {testResult.serverVersion && <span>MongoDB {testResult.serverVersion}</span>}
                    {testResult.topology && <span className="capitalize">{testResult.topology}</span>}
                    {testResult.replicaSet && <span>RS: {testResult.replicaSet}</span>}
                    {testResult.latency !== undefined && (
                      <span className={
                        testResult.latency < 100 ? 'text-success' :
                        testResult.latency < 500 ? 'text-yellow-400' : 'text-error'
                      }>
                        {testResult.latency}ms
                      </span>
                    )}
                    {testResult.tlsEnabled && <span>TLS</span>}
                  </div>
                )}
                {!testResult.success && (
                  <>
                    <div className="text-xs text-red-300 mt-1">{testResult.error}</div>
                    {testResult.hint && (
                      <div className="text-xs text-red-200/70 mt-1">{testResult.hint}</div>
                    )}
                  </>
                )}
              </div>
              <button
                onClick={() => setTestResult(null)}
                className="text-text-dim hover:text-text text-xs"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <div className="flex items-center gap-4">
            <button
              onClick={handleTestConnection}
              disabled={isTesting}
              className="px-4 py-2 bg-surface-hover hover:bg-surface-active text-text rounded-md transition-colors disabled:opacity-50"
              title="Test Connection (Cmd/Ctrl+T)"
            >
              {isTesting ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-surface-hover hover:bg-surface-active text-text rounded-md transition-colors"
              title="Cancel (Esc)"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={errors.some(e => e.severity === 'error')}
              className="px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Save Connection (Cmd/Ctrl+S)"
            >
              Save Connection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
