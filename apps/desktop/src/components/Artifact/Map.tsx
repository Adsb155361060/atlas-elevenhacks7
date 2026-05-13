import { useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';

// Leaflet's default marker icons point at relative URLs that don't resolve
// inside the Tauri webview. Override with the inlined PNG fix.
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

const DEFAULT_ICON = L.icon({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
});

interface MapData {
  /** Center coordinates [lat, lng]. */
  center?: [number, number];
  zoom?: number;
  markers?: Array<{
    lat: number;
    lng: number;
    label?: string;
    detail?: string;
  }>;
  title?: string;
}

export function MapArtifact({ data }: { data: unknown }) {
  const d = (data as MapData) ?? {};
  const center: [number, number] = d.center ?? [51.5074, -0.1278]; // London fallback
  const zoom = d.zoom ?? 12;
  const markers = d.markers ?? [];

  useEffect(() => {
    L.Marker.prototype.options.icon = DEFAULT_ICON;
  }, []);

  return (
    <div className="space-y-2">
      {d.title ? <h3 className="text-sm font-medium text-slate-100">{d.title}</h3> : null}
      <div className="rounded-md overflow-hidden border border-slate-800 h-[360px]">
        <MapContainer
          center={center}
          zoom={zoom}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {markers.map((m, i) => (
            <Marker key={i} position={[m.lat, m.lng]}>
              {(m.label || m.detail) && (
                <Popup>
                  {m.label ? <strong>{m.label}</strong> : null}
                  {m.detail ? <p>{m.detail}</p> : null}
                </Popup>
              )}
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
