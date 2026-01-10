const VestaHeader = () => {
  return (
    <header className="border-b border-vesta-header-border bg-card">
      <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            Vesta
          </h1>
          <p className="text-sm text-muted-foreground">
            Internal AI Assistant
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-vesta-status" />
          <span>Local • Session-only • No storage</span>
        </div>
      </div>
    </header>
  );
};

export default VestaHeader;
