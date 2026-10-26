import { Component } from 'react';

// Keep navigation and the local database available if a module fails to render.
export default class ModuleBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    // Never include form contents, account details or tokens in diagnostics.
    console.error('EletroAgro: falha ao renderizar um módulo. Os dados locais foram preservados.');
  }
  componentDidUpdate(previous) {
    if (previous.page !== this.props.page && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="workspace-page" role="alert"><h1>Não foi possível abrir esta tela</h1><p>Os lançamentos guardados no aparelho continuam preservados. Você pode acessar outro módulo ou tentar abrir esta tela novamente.</p><button className="customers-primary" onClick={() => this.setState({ failed: false })}>Tentar novamente</button></section>;
  }
}
