'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Cloud } from 'lucide-react';

const monthNames = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];
const week = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

const timezoneLocations: Record<
  string,
  { latitude: number; longitude: number; label: string }
> = {
  'America/Sao_Paulo': {
    latitude: -23.5505,
    longitude: -46.6333,
    label: 'São Paulo, SP',
  },
  'America/Fortaleza': {
    latitude: -3.7319,
    longitude: -38.5267,
    label: 'Fortaleza, CE',
  },
  'America/Manaus': {
    latitude: -3.119,
    longitude: -60.0217,
    label: 'Manaus, AM',
  },
  'America/Recife': {
    latitude: -8.0476,
    longitude: -34.877,
    label: 'Recife, PE',
  },
};

function weatherDescription(code: number) {
  if (code === 0) return 'Céu limpo';
  if (code <= 3) return code === 3 ? 'Nublado' : 'Pouco nublado';
  if (code === 45 || code === 48) return 'Nevoeiro';
  if (code >= 51 && code <= 57) return 'Garoa';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return 'Chuva';
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return 'Neve';
  }
  if (code >= 95) return 'Tempestade';
  return 'Tempo variável';
}

function localDateLabel(date: Date) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const capitalize = (value: string) =>
    value ? value[0].toLocaleUpperCase('pt-BR') + value.slice(1) : value;

  return `${capitalize(read('weekday'))}, ${read('day')} de ${capitalize(
    read('month'),
  )} de ${read('year')}`;
}

export function LiveCalendar() {
  const [now, setNow] = useState(new Date());
  const [offset, setOffset] = useState(0);
  const [weather, setWeather] = useState<{
    temperature: number | null;
    condition: string;
    location: string;
  }>(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const configured = timezoneLocations[timezone];
    return {
      temperature: null,
      condition: 'Clima indisponível',
      location:
        configured?.label ?? timezone.split('/').at(-1)?.replaceAll('_', ' ') ?? '',
    };
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const configured = timezoneLocations[timezone];
    if (!configured) return;

    const controller = new AbortController();
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(configured.latitude));
    url.searchParams.set('longitude', String(configured.longitude));
    url.searchParams.set('current', 'temperature_2m,weather_code');
    url.searchParams.set('timezone', 'auto');

    void fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('weather-unavailable');
        return response.json() as Promise<{
          current?: { temperature_2m?: number; weather_code?: number };
        }>;
      })
      .then((data) => {
        const temperature = data.current?.temperature_2m;
        const code = data.current?.weather_code;
        if (typeof temperature !== 'number' || typeof code !== 'number') return;
        setWeather({
          temperature: Math.round(temperature),
          condition: weatherDescription(code),
          location: configured.label,
        });
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, []);

  const viewed = useMemo(
    () => new Date(now.getFullYear(), now.getMonth() + offset, 1),
    [now, offset],
  );
  const cells = useMemo(() => {
    const first = viewed.getDay();
    const last = new Date(
      viewed.getFullYear(),
      viewed.getMonth() + 1,
      0,
    ).getDate();
    const previous = new Date(
      viewed.getFullYear(),
      viewed.getMonth(),
      0,
    ).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - first + 1;
      if (day < 1) {
        return {
          day: previous + day,
          current: false,
          date: new Date(
            viewed.getFullYear(),
            viewed.getMonth() - 1,
            previous + day,
          ),
        };
      }
      if (day > last) {
        return {
          day: day - last,
          current: false,
          date: new Date(
            viewed.getFullYear(),
            viewed.getMonth() + 1,
            day - last,
          ),
        };
      }
      return {
        day,
        current: true,
        date: new Date(viewed.getFullYear(), viewed.getMonth(), day),
      };
    });
  }, [viewed]);

  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

  return (
    <section className="surface-panel live-calendar-card">
      <div className="clock-pane">
        <div className="live-clock">
          <strong>
            {new Intl.DateTimeFormat('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }).format(now)}
          </strong>
          <p>{localDateLabel(now)}</p>
        </div>

        <div className="weather-card">
          <Cloud className="weather-icon" strokeWidth={1.7} aria-hidden="true" />
          <div>
            <strong>
              {weather.temperature === null ? '—°C' : `${weather.temperature}°C`}
            </strong>
            <span>{weather.condition}</span>
            <small>{weather.location}</small>
          </div>
          <a
            className="weather-attribution"
            href="https://open-meteo.com/"
            target="_blank"
            rel="noreferrer"
            aria-label="Dados meteorológicos fornecidos por Open-Meteo"
          >
            Open-Meteo
          </a>
        </div>
      </div>

      <div className="calendar-pane">
        <header>
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => setOffset((value) => value - 1)}
          >
            <ChevronLeft />
          </button>
          <h2>
            {monthNames[viewed.getMonth()]} de {viewed.getFullYear()}
          </h2>
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() => setOffset((value) => value + 1)}
          >
            <ChevronRight />
          </button>
        </header>
        <div className="calendar-week">
          {week.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-days">
          {cells.map((cell, index) => {
            const key = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`;
            return (
              <span
                key={index}
                data-current={cell.current}
                data-today={key === todayKey}
              >
                {cell.day}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
