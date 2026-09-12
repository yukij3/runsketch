// OpenFreeMap positron, quietened into a plate: no POIs or shields, muted labels, visible paths,
// and a subtle Mapterhorn hillshade under roads and labels.
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

export const DEM_SOURCE_ID = 'rs-dem';
export const HILLSHADE_LAYER_ID = 'rs-hillshade';

const HIDDEN = /poi|housenumber|shield|airport/i;
const LABEL_INK = '#5b6068';
const WATER_LABEL_INK = '#5f6f8c';
const PATH_INK = '#cbd0d6';

function mute(layer: LayerSpecification): LayerSpecification {
  if (layer.type === 'symbol' && layer.paint && 'text-color' in layer.paint) {
    const water = /water/.test(layer.id);
    return { ...layer, paint: { ...layer.paint, 'text-color': water ? WATER_LABEL_INK : LABEL_INK } };
  }
  if (layer.type === 'line' && layer.id === 'highway_path') {
    return { ...layer, paint: { ...layer.paint, 'line-color': PATH_INK } };
  }
  return layer;
}

export function transformPositron(style: StyleSpecification, demTileJsonUrl: string): StyleSpecification {
  const layers = style.layers.filter((l) => !HIDDEN.test(l.id)).map(mute);
  // Shade the ground fills only: insert before the first line or symbol layer (waterways, roads, labels).
  const at = layers.findIndex((l) => l.type === 'line' || l.type === 'symbol');
  const hillshade: LayerSpecification = {
    id: HILLSHADE_LAYER_ID,
    type: 'hillshade',
    source: DEM_SOURCE_ID,
    paint: {
      'hillshade-exaggeration': 0.25,
      'hillshade-shadow-color': 'rgba(27, 29, 34, 0.55)',
      'hillshade-highlight-color': 'rgba(255, 255, 255, 0.4)',
      'hillshade-accent-color': 'rgba(27, 29, 34, 0.25)',
    },
  };
  layers.splice(at < 0 ? layers.length : at, 0, hillshade);
  return {
    ...style,
    sources: {
      ...style.sources,
      [DEM_SOURCE_ID]: { type: 'raster-dem', url: demTileJsonUrl, encoding: 'terrarium', tileSize: 512 },
    },
    layers,
  };
}
