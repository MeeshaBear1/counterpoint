import type { CapacitorConfig } from '@capacitor/cli'

// Wraps the same Vite build as native iOS + Android apps. Web Audio (Tone.js)
// runs in WKWebView / Android WebView unchanged. `npx cap add ios|android`
// generates the native projects (run on macOS for iOS).
const config: CapacitorConfig = {
  appId: 'com.meeshabear.counterpoint',
  appName: 'Counterpoint',
  webDir: 'dist',
  backgroundColor: '#06060a',
  ios: { backgroundColor: '#06060a' },
  android: { backgroundColor: '#06060a' },
}

export default config
