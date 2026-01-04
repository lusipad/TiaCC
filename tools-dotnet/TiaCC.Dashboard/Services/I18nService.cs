using System.Net.Http.Json;

namespace TiaCC.Dashboard.Services;

public class I18nService
{
    private readonly HttpClient _httpClient;
    private Dictionary<string, string> _translations = new();
    private string _currentLocale = "en";

    public event Action? OnLanguageChanged;

    public string CurrentLocale => _currentLocale;

    public static readonly LocaleInfo[] SupportedLocales =
    [
        new("en", "English"),
        new("zh", "中文")
    ];

    public record LocaleInfo(string Code, string Name);

    public I18nService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task InitializeAsync()
    {
        // Try to load saved locale from localStorage via JS interop
        // Default to English
        await LoadTranslationsAsync(_currentLocale);
    }

    public async Task SetLocaleAsync(string locale)
    {
        if (_currentLocale == locale) return;

        _currentLocale = locale;
        await LoadTranslationsAsync(locale);
        OnLanguageChanged?.Invoke();
    }

    private async Task LoadTranslationsAsync(string locale)
    {
        try
        {
            var translations = await _httpClient.GetFromJsonAsync<Dictionary<string, string>>($"i18n/{locale}.json");
            _translations = translations ?? new();
        }
        catch
        {
            // Fallback to empty if file not found
            _translations = new();
        }
    }

    public string T(string key)
    {
        return _translations.TryGetValue(key, out var value) ? value : key;
    }

    public string T(string key, params object[] args)
    {
        var template = T(key);
        try
        {
            return string.Format(template, args);
        }
        catch
        {
            return template;
        }
    }
}
