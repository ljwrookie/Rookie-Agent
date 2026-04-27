use rookie_core::server::RookieServer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let server = RookieServer::new();
    server.serve_stdio().await
}
