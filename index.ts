import { Observable, Subject } from 'rxjs/Rx';
import * as serialport from 'serialport';
import * as ayb from 'all-your-base';
import * as _ from 'lodash';
import datapoints from './datapoints';

export class WaterRower {
    port: serialport.SerialPort;
    private reads$: Subject<string> = new Subject<string>();
    private datapoints$: Observable<DataPoint>;
    private dataPointDelay:number;

    constructor(options?: WaterRowerOptions) {
        this.dataPointDelay = options.dataPointDelay || 200;
        if (options.simulationMode) {
            //TODO: implement simulation mode
        }
        else {
            if (!options.portName) throw "A port name is required";

            // setup the serial port
            this.port = new serialport.SerialPort(options.portName, {
                baudrate: options.baudRate || 19200,
                disconnectedCallback: function () { console.log('disconnected'); },
                parser: serialport.parsers.readline("\n")
            });

            // setup port events
            this.port.on('open', function () {
                console.log(`A connection to the WaterRower has been established on ${options.portName}`);

                this.initialize(); //start things off
                this.setDisplayUnits(Units.Meters); //change the display to meters
                this.reset(); //reset the waterrower 

                setInterval(function () {
                    this.requestDistance();
                    this.requestSpeed();
                    this.requestClock();
                }, options.refreshRate || 200);
            });

            this.port.on('data', d => this.reads$.next(d));
            this.port.on('closed', () => console.log('connection closed'));
            this.port.on('error', err => console.log('Please plug in your WaterRower and start again...'));
        }
        
        //data categories
        let pings$ = this.reads$.filter(d => /PING/.test(d));
        let pulses$ = this.reads$.filter(d => /P([0-9A-F]{2})/.test(d))
            .map(d => /P([0-9A-F]{2})/.exec(d)[1]);
        let errors$ = this.reads$.filter(d => /ERROR/.test(d));
        let strokestarts$ = this.reads$.filter(d => /SS/.test(d));
        let strokeends$ = this.reads$.filter(d => /SE/.test(d));

        // this is the important stream for reading memory locations from the rower
        // IDS is a single, IDD is a double, and IDT is a triple byte memory location
        this.datapoints$ = this.reads$.filter(d => /ID([SDT])([0-9A-F]{3})([0-9A-F]+)/.test(d))
            .map(d => {
                let m = /ID([SDT])([0-9A-F]{3})([0-9A-F]+)/.exec(d);
                return {
                    name:_.find(datapoints, point => point.address == m[2]).name,
                    length: { 'S': 1, 'D': 2, 'T': 3 }[m[1]],
                    address: m[2],
                    value: m[3]
                };
            });

        this.datapoints$.subscribe(d2 => {
            _.find(datapoints, d1 => d1.address == d2.address).value = ayb.hexToDec(d2.value);
        })

    }

    /// send a serial message
    private send(value) {
        this.port.write(value + '\r\n');
    }

    /// initialize the connection    
    initialize() {
        this.send('USB');
    }

    /// reset console
    reset() {
        this.send('RESET'); //reset the waterrower 
    }

    /// set up new workout session on the WR with set distance
    defineDistanceWorkout(distance: number, units: Units) {
        this.send(`WSI${units}${ayb.decToHex(distance)}`);
    }

    /// set up new workout session on the WR with set duration
    defineDurationWorkout(seconds: number) {
        this.send('WSU${ayb.decToHex(seconds)}');
    }

    requestAll() {
        datapoints.forEach(d => this.requestDataPoint(d));
    }

    requestDataPoint(name:string) {
        let dataPoint = _.find(datapoints, d => d.name == name);
        this.send(`IR${dataPoint.length}${dataPoint.address}`)
    }
    
    observeDatapoint$(name:string) {
        this.requestDataPoint(name);
        setTimeout(() => this.datapoints$.filter(d => d.name == name), this.dataPointDelay);
    }

    /// change the display to meters, miles, kilometers, or strokes
    displaySetDistance(units: Units) {
        let value = 'DD';
        switch (units) {
            case Units.Meters: value += 'ME'; break;
            case Units.Miles: value += 'MI'; break;
            case Units.Kilometers: value += 'KM'; break;
            case Units.Strokes: value += 'ST'; break;
            default: throw 'units must be meters, miles, kilometers, or strokes';
        }
        this.send(value);
    }

    /// change the intensity display
    displaySetIntensity(option: IntensityDisplayOptions) {
        let value = 'DD';
        switch (option) {
            case IntensityDisplayOptions.MetersPerSecond: value += 'MS'; break;
            case IntensityDisplayOptions.MPH: value += 'MPH'; break;
            case IntensityDisplayOptions._500m: value += '500'; break;
            case IntensityDisplayOptions._2km: value += '2KM'; break;
            case IntensityDisplayOptions.Watts: value += 'WA'; break;
            case IntensityDisplayOptions.CaloriesPerHour: value += 'CH'; break;
        }
        this.send(value);
    }

    /// change the average intensity display
    displaySetAverageIntensity(option: AverageIntensityDisplayOptions) {
        let value = 'DD';
        switch (option) {
            case AverageIntensityDisplayOptions.AverageMetersPerSecond: value += 'MS'; break;
            case AverageIntensityDisplayOptions.AverageMPH: value += 'MPH'; break;
            case AverageIntensityDisplayOptions._500m: value += '500'; break;
            case AverageIntensityDisplayOptions._2km: value += '2KM'; break;
            default: throw 'units must be meters, miles, kilometers, or strokes';
        }
        this.send(value);
    }

}

export interface WaterRowerOptions {
    portName: string;
    baudRate?: number;
    refreshRate?: number;
    simulationMode?: boolean;
    dataPointDelay?: number;
}

export enum IntensityDisplayOptions {
    MetersPerSecond,
    MPH,
    _500m,
    _2km,
    Watts,
    CaloriesPerHour
}

export enum AverageIntensityDisplayOptions {
    AverageMetersPerSecond,
    AverageMPH,
    _500m,
    _2km
}

export enum Units {
    Meters = 1,
    Miles = 2,
    Kilometers = 3,
    Strokes = 4
}

export interface DataPoint {
    name?: string,
    address: string,
    length: string,
    value: any
}
