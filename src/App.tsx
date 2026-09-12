import { MapPlate } from './ui/map/MapPlate';
import { ExportBar } from './ui/sheet/ExportBar';
import { Masthead } from './ui/sheet/Masthead';
import { ProtocolSheet } from './ui/sheet/ProtocolSheet';
import { TracesStrip } from './ui/TracesStrip';
import { useDocumentMeta, useShortcuts } from './ui/useShell';

export function App() {
  useShortcuts();
  useDocumentMeta();
  return (
    <div className="app">
      <Masthead />
      <main className="map-area">
        <MapPlate />
        <TracesStrip />
      </main>
      <ProtocolSheet />
      <ExportBar />
    </div>
  );
}
