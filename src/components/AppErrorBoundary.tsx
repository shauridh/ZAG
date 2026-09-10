import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Error boundary global: halaman rusak tidak boleh memblanko tanpa pesan. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('App error boundary:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-lg font-extrabold text-brand-redtext">Terjadi kesalahan di halaman ini</p>
          <p className="max-w-md text-sm text-brand-muted">{this.state.error.message}</p>
          <button type="button" className="btn-primary" onClick={() => window.location.assign('/')}>
            Kembali ke Dashboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
