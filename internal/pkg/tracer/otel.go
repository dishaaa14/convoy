package tracer

import (
	"context"
	"errors"
	"time"

	"go.opentelemetry.io/otel/trace"

	"github.com/frain-dev/convoy"
	"github.com/frain-dev/convoy/config"
	"github.com/frain-dev/convoy/util"
	"go.opentelemetry.io/otel"
	"google.golang.org/grpc/credentials"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.10.0"
)

var ErrInvalidCollectorURL = errors.New("invalid OTel Collector URL")
var ErrInvalidOTelSSLConfig = errors.New("invalid OTel ssl cert or key configuration")
var ErrFailedToCreateTLSCredentials = errors.New("failed to create tls credentials from config")

type OTelTracer struct {
	cfg        config.OTelConfiguration
	ShutdownFn func(ctx context.Context) error
}

func NewOTelTracer(cfg config.OTelConfiguration) *OTelTracer {
	return &OTelTracer{
		cfg: cfg,
		ShutdownFn: func(ctx context.Context) error {
			return nil
		},
	}
}

func (ot *OTelTracer) Init(componentName string) error {
	var opts []otlptracegrpc.Option

	if util.IsStringEmpty(ot.cfg.CollectorURL) {
		return ErrInvalidCollectorURL
	}
	opts = append(opts, otlptracegrpc.WithEndpoint(ot.cfg.CollectorURL))

	if ot.cfg.OTelAuth != (config.OTelAuthConfiguration{}) {
		opts = append(opts, otlptracegrpc.WithHeaders(
			map[string]string{
				ot.cfg.OTelAuth.HeaderName: ot.cfg.OTelAuth.HeaderValue}))
	}

	if ot.cfg.InsecureSkipVerify {
		secureOption := otlptracegrpc.WithInsecure()
		opts = append(opts, secureOption)
	} else {
		secureOption := otlptracegrpc.WithTLSCredentials(credentials.NewClientTLSFromCert(nil, ""))
		opts = append(opts, secureOption)
	}

	exporter, err := otlptrace.New(context.Background(), otlptracegrpc.NewClient(opts...))
	if err != nil {
		return err
	}

	// Configure Resources.
	resources, err := resource.New(
		context.Background(),
		resource.WithAttributes(
			attribute.KeyValue{
				Key:   semconv.ServiceNameKey,
				Value: attribute.StringValue(componentName),
			},
			attribute.KeyValue{
				Key:   semconv.ServiceVersionKey,
				Value: attribute.StringValue(convoy.GetVersion()),
			},
		),
	)
	if err != nil {
		return err
	}

	// Configure Tracer Provider.
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resources),
		sdktrace.WithSampler(sdktrace.TraceIDRatioBased(ot.cfg.SampleRate)),
	)

	// Configure OTel SDK
	otel.SetTracerProvider(tp)

	// Configure Propagator
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	ot.ShutdownFn = tp.Shutdown

	return nil
}

func (ot *OTelTracer) Type() config.TracerProvider {
	return config.OTelTracerProvider
}

func (ot *OTelTracer) Capture(ctx context.Context, name string, attributes map[string]interface{}, startTime time.Time, endTime time.Time) {
	_, span := otel.Tracer("").Start(ctx, name,
		trace.WithTimestamp(startTime))

	// End span with provided end time
	defer span.End(trace.WithTimestamp(endTime))

	// Convert and set attributes
	attrs := make([]attribute.KeyValue, 0, len(attributes))
	for k, v := range attributes {
		switch val := v.(type) {
		case string:
			attrs = append(attrs, attribute.String(k, val))
		case int:
			attrs = append(attrs, attribute.Int(k, val))
		case int64:
			attrs = append(attrs, attribute.Int64(k, val))
		case float64:
			attrs = append(attrs, attribute.Float64(k, val))
		case bool:
			attrs = append(attrs, attribute.Bool(k, val))
		}
	}
	span.SetAttributes(attrs...)
}

func (ot *OTelTracer) Shutdown(ctx context.Context) error {
	return ot.ShutdownFn(ctx)
}
