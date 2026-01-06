using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using TiaCC.Dashboard;
using TiaCC.Dashboard.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
builder.Services.AddScoped<CoverageDataService>();
builder.Services.AddScoped<I18nService>();

var host = builder.Build();

// Initialize i18n service
var i18n = host.Services.GetRequiredService<I18nService>();
await i18n.InitializeAsync();

await host.RunAsync();
