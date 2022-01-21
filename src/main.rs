use warp::Filter;

#[tokio::main]
async fn main() {
    let api = warp::path!("api" / "v1").map(|| "Not Implemented");
    let file = warp::fs::dir("./public/dist");
    let routes = warp::get().and(api.or(file));
    warp::serve(routes).run(([127, 0, 0, 1], 3030)).await;
}
