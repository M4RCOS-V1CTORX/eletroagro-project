import { LoaderCircle } from 'lucide-react';
import './qrcode.css';

export default function QRCodePage() {
  return (
    <section className="workspace-page qrcode-page" aria-label="QR Code">
      <div className="qrcode-development" role="status">
        <LoaderCircle className="spin" size={40} aria-hidden="true" />
        <h1>em desenvolvimento</h1>
      </div>
    </section>
  );
}
